import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ensureProduct, fulfillCheckout, releaseSchedule } from "@/lib/billing";
import { checkoutFailure } from "@/lib/checkout-error";
import { SITE_URL } from "@/lib/env";
import { INDIA_CURRENCY, INDIA_PLANS, PLANS } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { isActive, type Subscription } from "@/lib/types";

const body = z.object({
  tier: z.enum(["virtual", "ai"]),
  keepCurrent: z.literal(true).optional(),
});

async function indiaCustomer(user: { id: string; email?: string }) {
  const customers = createAdminClient().from("india_stripe_customers");
  const { data, error } = await customers.select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data.stripe_customer_id as string;

  const customer = await stripe().customers.create(
    { email: user.email, metadata: { user_id: user.id, market: "IN" } },
    { idempotencyKey: `tapsynk-india-customer-${user.id}` },
  );
  const { error: insertError } = await customers.upsert(
    { user_id: user.id, stripe_customer_id: customer.id },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
  const { data: saved, error: readError } = await customers.select("stripe_customer_id").eq("user_id", user.id).single();
  if (readError) throw readError;
  return saved.stripe_customer_id as string;
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid plan." }, { status: 400 });
  if (!(await rateLimit(`checkout:${user.id}`, 10, 600))) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const { tier, keepCurrent } = parsed.data;
  const offer = INDIA_PLANS[tier];
  const oneTime = tier === "virtual";
  const metadata = { user_id: user.id, tier, interval: offer.interval, kind: oneTime ? "india_virtual" : "india_ai" };

  try {
    const [{ data: existing, error: subscriptionError }, { data: purchased, error: purchaseError }] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("orders").select("id").eq("user_id", user.id).is("company_id", null)
        .eq("tier", "virtual").eq("billing_interval", "once").eq("currency", INDIA_CURRENCY)
        .eq("amount_total", INDIA_PLANS.virtual.amount).limit(1).maybeSingle(),
    ]);
    if (subscriptionError || purchaseError) throw new Error("Could not check the current plan");
    const current = existing as Subscription | null;

    if (keepCurrent && current?.stripe_subscription_id && current.tier === tier && current.pending_tier) {
      const sub = await stripe().subscriptions.retrieve(current.stripe_subscription_id);
      await releaseSchedule(typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id);
      const { error } = await createAdminClient().from("subscriptions")
        .update({ pending_tier: null, pending_interval: null, pending_change_at: null, stripe_schedule_id: null })
        .eq("stripe_subscription_id", sub.id);
      if (error) throw error;
      return NextResponse.json({ url: "/dashboard/billing?kept=1" });
    }
    if (keepCurrent) return NextResponse.json({ error: "There is no scheduled switch to cancel." }, { status: 400 });
    if (oneTime && purchased) return NextResponse.json({ error: "You already own the Virtual Card." }, { status: 409 });
    if (!oneTime && isActive(current)) {
      const error = current?.tier === "ai"
        ? "You already have an AI Card subscription. Manage it under Plan & billing."
        : "Manage your existing subscription under Plan & billing. You can subscribe to the India AI Card when it ends.";
      return NextResponse.json({ error }, { status: 409 });
    }

    const customer = await indiaCustomer(user);
    // Reuse a session for retries, including when Stripe completes payment before the webhook arrives.
    let latest;
    for await (const session of stripe().checkout.sessions.list({ customer, limit: 20 })) {
      if (session.metadata?.kind === metadata.kind) {
        latest = session;
        break;
      }
    }
    if (latest?.status === "open" && latest.url) return NextResponse.json({ url: latest.url });
    if (latest?.status === "complete") {
      const subscriptionId = typeof latest.subscription === "string" ? latest.subscription : latest.subscription?.id;
      const sub = subscriptionId ? await stripe().subscriptions.retrieve(subscriptionId) : null;
      if (latest.payment_status === "unpaid") {
        const paymentId = typeof latest.payment_intent === "string" ? latest.payment_intent : latest.payment_intent?.id;
        const payment = paymentId ? await stripe().paymentIntents.retrieve(paymentId) : null;
        const failed = sub?.status === "incomplete_expired" || sub?.status === "canceled" ||
          (oneTime && (payment?.status === "requires_payment_method" || payment?.status === "canceled"));
        if (!failed) {
          return NextResponse.json({ error: "Your payment is still being confirmed. Check Plan & billing shortly." }, { status: 409 });
        }
      } else if (oneTime || isActive(sub)) {
        await fulfillCheckout(latest.id);
        return NextResponse.json({ url: `/dashboard/billing/success?session_id=${latest.id}` });
      }
    }

    const product = await ensureProduct(tier);
    const session = await stripe().checkout.sessions.create({
      managed_payments: { enabled: false },
      adaptive_pricing: { enabled: false },
      mode: oneTime ? "payment" : "subscription",
      line_items: [{
        price_data: {
          currency: INDIA_CURRENCY,
          product,
          unit_amount: offer.amount,
          ...(!oneTime ? { recurring: { interval: "month" as const } } : {}),
        },
        quantity: 1,
      }],
      customer,
      customer_update: { name: "auto", address: "auto", shipping: "auto" },
      client_reference_id: user.id,
      metadata,
      ...(oneTime
        ? { invoice_creation: { enabled: true, invoice_data: { metadata } } }
        : { subscription_data: { metadata, description: "TapSynk India AI Card · Monthly subscription" } }),
      shipping_address_collection: { allowed_countries: ["IN"] },
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      custom_text: {
        shipping_address: { message: "Your NFC business card ships free to this address in India." },
        submit: { message: oneTime ? "You pay once for the Virtual Card." : "The AI Card renews monthly until cancelled." },
      },
      success_url: `${SITE_URL}/dashboard/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/dashboard/billing?plan=${tier}&canceled=1`,
    }, { idempotencyKey: `tapsynk-india-${customer}-${tier}-${latest?.id ?? "first"}` });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    const failure = checkoutFailure(e);
    console.error("India checkout error", failure.diagnostics);
    return NextResponse.json({ error: failure.message }, { status: 500 });
  }
}
