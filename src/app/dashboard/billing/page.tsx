import Link from "next/link";
import { ArrowRightLeft, CheckCircle2, Package, Receipt as ReceiptIcon, Truck } from "lucide-react";
import { PricingTable } from "@/components/PricingTable";
import { requireDashboardData } from "@/lib/data";
import { INDIA_CURRENCY, INDIA_PLANS, INTERVALS, PLANS, billingLabel, isTier } from "@/lib/plans";
import { isActive, type Order } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/utils";
import { KeepPlanButton } from "./KeepPlanButton";

const FULFILLMENT: Record<Order["fulfillment_status"], { label: string; icon: typeof Package }> = {
  processing: { label: "Processing", icon: Package },
  printing: { label: "Printing your card", icon: Package },
  shipped: { label: "Shipped", icon: Truck },
  delivered: { label: "Delivered", icon: CheckCircle2 },
};

export default async function BillingPage({ searchParams }: PageProps<"/dashboard/billing">) {
  const sp = await searchParams;
  const { supabase, subscription, user } = await requireDashboardData();
  const active = isActive(subscription);
  const { data } = await supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  const orders = (data ?? []) as Order[];
  const ownsVirtual = orders.some((order) => order.company_id === null && order.tier === "virtual" &&
    order.billing_interval === "once" && order.currency === INDIA_CURRENCY && order.amount_total === INDIA_PLANS.virtual.amount);
  const focus = isTier(sp.plan) ? sp.plan : undefined;

  return (
    <div className="fade-up mx-auto max-w-5xl">
      <h1 className="text-3xl font-bold tracking-tight">Plan & billing</h1>
      <p className="mb-8 mt-1 text-muted">
        Buy the Virtual Card once or choose a monthly AI Card subscription. Each includes NFC card delivery in India.
      </p>

      {sp.canceled && <p className="mb-6 rounded-xl border border-cream-line bg-cream px-4 py-3 text-sm">Checkout was canceled. No payment was taken.</p>}
      {typeof sp.kept === "string" && (
        <p className="mb-6 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">Your scheduled switch was cancelled. You stay on your current plan.</p>
      )}

      {active && subscription && (
        <section className="card-surface mb-10 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="text-sm font-semibold text-muted">Current plan</p>
            <p className="mt-1 text-2xl font-bold">
              {PLANS[subscription.tier].name} <span className="text-base font-medium text-muted">· {billingLabel(subscription.billing_interval)}</span>
            </p>
            <p className="text-sm text-muted">
              Status: <span className="font-semibold capitalize text-ink">{subscription.status === "trialing" ? "Free month" : subscription.status.replace("_", " ")}</span>
              {subscription.current_period_end && (
                <> · {subscription.status === "trialing" ? "first charge on" : "renews"} {formatDate(subscription.current_period_end)}</>
              )}
            </p>
          </div>
          {subscription.stripe_subscription_id && (
            <form action="/api/stripe/portal" method="post">
              <button className="btn btn-ghost">Manage billing & invoices</button>
            </form>
          )}
          {subscription.pending_tier && subscription.pending_interval && (
            <div className="flex w-full flex-col gap-3 rounded-2xl border border-cream-line bg-cream px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-sm text-ink-2">
                <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span>
                  Switching to <strong className="text-ink">{PLANS[subscription.pending_tier].name}</strong> ({INTERVALS[subscription.pending_interval].label.toLowerCase()})
                  {subscription.pending_change_at && <> on {formatDate(subscription.pending_change_at)}</>}. Your AI keeps working until then.
                </span>
              </p>
              <KeepPlanButton tier={subscription.tier} label={`Keep ${PLANS[subscription.tier].name}`} />
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-6 text-center text-xl font-bold">Card options</h2>
        <PricingTable
          mode="dashboard"
          ownsVirtual={ownsVirtual}
          activeTier={active && subscription?.billing_interval !== "once" ? subscription?.tier : undefined}
          focus={focus}
        />
      </section>

      {orders.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-4 text-xl font-bold">Card orders & receipts</h2>
          <ul className="card-surface divide-y divide-line">
            {orders.map((o) => {
              const f = FULFILLMENT[o.fulfillment_status];
              return (
                <li key={o.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{o.company_id ? `Company · ${o.quantity} × ${PLANS[o.tier].name}` : `${PLANS[o.tier].name} · ${billingLabel(o.billing_interval)}`}</p>
                    <p className="font-mono text-xs text-muted">{o.receipt_number} · {formatDate(o.created_at)}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2"><f.icon className="h-4 w-4 text-brand" /> {f.label}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-bold tabular-nums">{formatMoney(o.amount_total, o.currency)}</span>
                    <Link href={`/dashboard/billing/receipt/${o.id}`} className="btn btn-cream py-2 text-sm"><ReceiptIcon className="h-4 w-4" /> Receipt</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
