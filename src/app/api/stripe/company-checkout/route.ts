import { NextResponse, type NextRequest } from "next/server";
import { checkoutFailure } from "@/lib/checkout-error";
import { z } from "zod";
import { companyPriceData } from "@/lib/billing";
import { COMPANY_MAX_SEATS, COMPANY_MIN_SEATS } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { isActive, type Company } from "@/lib/types";

const body = z.object({
  tier: z.enum(["virtual", "ai"]),
  seats: z.number().int().min(COMPANY_MIN_SEATS).max(COMPANY_MAX_SEATS),
});

/** Updates an existing monthly company subscription. */
export async function POST(request: NextRequest) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Choose between ${COMPANY_MIN_SEATS} and ${COMPANY_MAX_SEATS} cards.` }, { status: 400 });
  if (!(await rateLimit(`company-checkout:${user.id}`, 10, 600))) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  const { data } = await supabase.from("companies").select("*").eq("owner_id", user.id).maybeSingle();
  const company = data as Company | null;
  if (!company || !isActive(company) || !company.stripe_subscription_id) {
    return NextResponse.json({ error: "Request a team quote to start a new company plan in India." }, { status: 409 });
  }
  const { tier, seats } = parsed.data;

  const { count } = await supabase.from("cards").select("id", { count: "exact", head: true }).eq("company_id", company.id);
  if ((count ?? 0) > seats) return NextResponse.json({ error: `You have ${count} employee cards. Remove some before going below that.` }, { status: 400 });

  const metadata = { kind: "company", user_id: user.id, company_id: company.id, tier, seats: String(seats), interval: "month" };

  try {
    // Existing company: change seats or card type in place, prorated on the next monthly bill.
    if (company.tier === tier && company.seats === seats) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    const sub = await stripe().subscriptions.retrieve(company.stripe_subscription_id);
    await stripe().subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0]!.id, price_data: await companyPriceData(tier, seats), quantity: seats }],
      proration_behavior: "create_prorations",
      metadata,
    });
    // Keep the seat limit in step right away; the webhook confirms it.
    await createAdminClient().from("companies").update({ tier, seats, updated_at: new Date().toISOString() }).eq("id", company.id);
    return NextResponse.json({ url: "/dashboard/company/billing?changed=1" });
  } catch (e) {
    const failure = checkoutFailure(e);
    console.error("Company checkout error", failure.diagnostics);
    return NextResponse.json({ error: failure.message }, { status: 500 });
  }
}
