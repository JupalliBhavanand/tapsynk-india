"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, IdCard, Loader2, Sparkles } from "lucide-react";
import { INDIA_CURRENCY, INDIA_PLANS, PLANS, type Tier } from "@/lib/plans";
import { cn, formatMoney } from "@/lib/utils";

export function PricingTable({
  mode = "marketing",
  ownsVirtual = false,
  activeTier,
  focus,
}: {
  mode?: "marketing" | "dashboard";
  ownsVirtual?: boolean;
  activeTier?: Tier;
  focus?: Tier;
}) {
  const [loading, setLoading] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(tier: Tier) {
    setLoading(tier);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Could not start checkout.");
      window.location.assign(result.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not start checkout.");
      setLoading(null);
    }
  }

  return (
    <div>
      {error && <p role="alert" className="mx-auto mb-5 max-w-md text-center text-sm text-stamp">{error}</p>}
      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
        {(["virtual", "ai"] as const).map((tier) => {
          const plan = PLANS[tier];
          const offer = INDIA_PLANS[tier];
          const ai = tier === "ai";
          const owned = ai ? activeTier === "ai" : ownsVirtual;
          const legacyVirtual = ai && activeTier === "virtual";
          const Icon = ai ? Sparkles : IdCard;
          const price = formatMoney(offer.amount, INDIA_CURRENCY).replace(/\.00$/, "");
          const next = `/dashboard/billing?plan=${tier}`;
          const label = ai ? "Subscribe to AI Card" : "Buy Virtual Card";
          return (
            <article
              key={tier}
              aria-labelledby={`plan-${tier}`}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-3xl p-6 sm:p-8",
                ai ? "bg-navy text-white shadow-[0_30px_60px_-25px_rgba(29,91,255,0.55)]" : "card-surface",
                focus === tier && "ring-2 ring-brand ring-offset-4 ring-offset-bg",
              )}
            >
              {ai && <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full bg-brand/50 blur-3xl" />}
              <div className="relative flex h-full flex-col">
                <span className={cn("grid h-11 w-11 place-items-center rounded-xl", ai ? "bg-white/10 text-brand-2" : "bg-brand-soft text-brand")}>
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <h3 id={`plan-${tier}`} className="mt-4 text-2xl font-bold">{plan.name}</h3>
                <p className={cn("mt-1 text-base", ai ? "text-white/75" : "text-muted")}>{plan.tagline}</p>
                <div className="mt-6">
                  <span className="text-5xl font-extrabold tracking-tight">{price}</span>
                  {ai && <span className="ml-2 text-base text-white/75">/ month</span>}
                </div>
                <p className={cn("mt-2 text-sm font-semibold", ai ? "text-brand-2" : "text-success")}>{offer.billingLabel}</p>
                <ul className="mb-7 mt-6 space-y-3 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-3">
                      <Check aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", ai ? "text-brand-2" : "text-brand")} />
                      <span className={ai ? "text-white/85" : "text-ink-2"}>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  {mode === "marketing" ? (
                    <Link href={`/signup?next=${encodeURIComponent(next)}`} className={cn("btn w-full", ai ? "btn-primary" : "btn-dark")}>{label}</Link>
                  ) : (
                    <button type="button" onClick={() => checkout(tier)} disabled={loading !== null || owned || legacyVirtual} className={cn("btn w-full", ai ? "btn-primary" : "btn-dark")}>
                      {loading === tier && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                      {owned ? (ai ? "Your current subscription" : "You own this card") : loading === tier ? "Opening checkout…" : label}
                    </button>
                  )}
                  <p className={cn("mt-3 text-center text-sm", ai ? "text-white/70" : "text-muted")}>
                    {legacyVirtual ? "You can subscribe once your current subscription ends." : ai ? "Cancel future renewals from your dashboard." : "Includes free NFC card delivery in India."}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
