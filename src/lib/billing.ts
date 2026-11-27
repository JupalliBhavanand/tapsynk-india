import "server-only";
import type Stripe from "stripe";
import { TAPSYNK_PROFILE_TABLE } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { INDIA_CURRENCY, INDIA_PLANS, PLANS, companyQuote, isInterval, isTier, type Tier } from "@/lib/plans";
import { stripe } from "@/lib/stripe";
import { isActive } from "@/lib/types";

/** Products get fixed ids so prices can be created inline from lib/plans.ts without dashboard setup. */
export async function ensureProduct(tier: Tier, company = false) {
  const id = company ? `tapsync_company_${tier}` : `tapsync_${tier}`;
  const name = company ? `TapSynk Company · ${PLANS[tier].name} (per employee)` : `TapSynk ${PLANS[tier].name}`;
  let product: Stripe.Product;
  try {
    product = await stripe().products.retrieve(id);
  } catch (error) {
    // Only create a missing product; authentication/network failures need their original diagnosis.
    if ((error as { code?: string }).code !== "resource_missing") throw error;
    try {
      await stripe().products.create({
        id,
        name,
        description: company ? "Monthly price per employee card, team discount applied." : PLANS[tier].tagline,
      });
    } catch (e) {
      // Another request created it at the same moment.
      if ((e as { code?: string }).code !== "resource_already_exists") throw e;
      await stripe().products.update(id, { name });
    }
    return id;
  }
  // Rebrand existing checkout products without changing their stable IDs or prices.
  if (product.name !== name) await stripe().products.update(id, { name });
  return id;
}

/** Per-seat monthly price for a company; the discount bracket depends on the seat count. */
export async function companyPriceData(tier: Tier, seats: number) {
  return {
    currency: "usd",
    product: await ensureProduct(tier, true),
    unit_amount: companyQuote(tier, seats).unit,
    recurring: { interval: "month" as const, interval_count: 1 },
  };
}

function receiptNumber(sessionId: string, created: number) {
  const d = new Date(created * 1000);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `TXN-${ymd}-${sessionId.slice(-8).toUpperCase()}`;
}

/** Mirrors a company's Stripe subscription onto its companies row. */
async function syncCompany(sub: Stripe.Subscription) {
  const companyId = sub.metadata?.company_id;
  if (!companyId) return;
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end;
  const tier = sub.metadata?.tier;
  await createAdminClient()
    .from("companies")
    .update({
      status: sub.status,
      ...(isTier(tier) ? { tier } : {}),
      ...(item?.quantity ? { seats: item.quantity } : {}),
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
}

/** Mirrors a Stripe subscription into Supabase. Safe to call repeatedly. */
export async function syncSubscription(sub: Stripe.Subscription) {
  if (sub.metadata?.kind === "company") return syncCompany(sub);
  const userId = sub.metadata?.user_id;
  if (!userId) return;
  const tier = sub.metadata?.tier;
  const interval = sub.metadata?.interval;
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end;
  const admin = createAdminClient();
  const details = {
    user_id: userId,
    tier: isTier(tier) ? tier : "virtual",
    billing_interval: isInterval(interval) ? interval : "month",
    status: sub.status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const subscriptions = admin.from("subscriptions");
  const { error } = isActive(sub)
    ? await subscriptions.upsert(details, { onConflict: "user_id" })
    : await subscriptions.update(details).eq("stripe_subscription_id", sub.id).eq("user_id", userId);
  if (error) throw error;
  // A scheduled switch is done once Stripe has applied it, or was dropped if the schedule is gone.
  const pending = admin.from("subscriptions").update({ pending_tier: null, pending_interval: null, pending_change_at: null, stripe_schedule_id: null }).eq("user_id", userId).eq("stripe_subscription_id", sub.id);
  if (!sub.schedule) await pending;
  else if (isTier(tier) && isInterval(interval)) await pending.eq("pending_tier", tier).eq("pending_interval", interval);
}

/** Stops a scheduled switch; the subscription carries on unchanged. */
export async function releaseSchedule(scheduleId: string | null | undefined) {
  if (!scheduleId) return;
  try {
    await stripe().subscriptionSchedules.release(scheduleId);
  } catch (e) {
    // Already released or finished.
    if ((e as { code?: string }).code !== "resource_missing" && !/released|completed|canceled/i.test(String((e as Error).message))) throw e;
  }
}

/**
 * Records a completed checkout: subscription + paid order with shipping address.
 * Called by the webhook and by the success page (whichever runs first), so it is idempotent.
 */
export async function fulfillCheckout(sessionId: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "subscription.default_payment_method", "payment_intent.payment_method"],
  });
  if (session.status !== "complete" || session.payment_status === "unpaid") return null;
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const tier = session.metadata?.tier;
  const interval = session.metadata?.interval;
  if (!userId || !isTier(tier)) return null;
  const oneTime = session.metadata?.kind === "india_virtual";
  if (oneTime) {
    if (tier !== "virtual" || interval !== "once" || session.mode !== "payment" ||
        session.payment_status !== "paid" || session.currency !== INDIA_CURRENCY ||
        session.amount_total !== INDIA_PLANS.virtual.amount) return null;
  } else if (!isInterval(interval) || session.mode !== "subscription") {
    return null;
  }

  const sub = session.subscription as Stripe.Subscription | null;
  if (sub) await syncSubscription(await stripe().subscriptions.retrieve(sub.id));
  const isCompany = session.metadata?.kind === "company";
  const companyId = isCompany ? session.metadata?.company_id ?? null : null;
  const quantity = Number(session.metadata?.seats) || 1;

  const payment = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const method = sub?.default_payment_method ?? payment?.payment_method;
  const pm = typeof method === "object" ? method : null;
  const shipping = session.collected_information?.shipping_details;
  const admin = createAdminClient();
  // The free month can only be used once per account.
  if (!isCompany && sub?.status === "trialing") {
    await admin.from(TAPSYNK_PROFILE_TABLE).update({ trial_used_at: new Date().toISOString() }).eq("id", userId).is("trial_used_at", null);
  }
  const { error } = await admin.from("orders").upsert(
    {
      user_id: userId,
      stripe_session_id: session.id,
      receipt_number: receiptNumber(session.id, session.created),
      tier,
      billing_interval: interval,
      company_id: companyId,
      quantity,
      amount_subtotal: session.amount_subtotal ?? 0,
      amount_discount: session.total_details?.amount_discount ?? 0,
      amount_tax: session.total_details?.amount_tax ?? 0,
      amount_total: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      card_brand: pm?.card?.brand ?? null,
      card_last4: pm?.card?.last4 ?? null,
      shipping_name: shipping?.name ?? session.customer_details?.name ?? null,
      shipping_address: shipping?.address ? {
        ...shipping.address,
        phone: session.customer_details?.phone ?? null,
        email: session.customer_details?.email ?? null,
      } : null,
    },
    { onConflict: "stripe_session_id", ignoreDuplicates: true },
  );
  if (error) throw new Error("Could not record the paid card order");
  return { userId, sessionId: session.id };
}
