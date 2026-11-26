import Link from "next/link";
import { Building2 } from "lucide-react";

export function CompanyPricing() {
  return (
    <div className="flex flex-col items-start gap-6 rounded-3xl border border-line bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div className="flex gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <Building2 aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-bold">Buying for a team?</h2>
          <p className="mt-1 max-w-prose text-muted">Get branded cards for your employees and see leads and activity in one dashboard.</p>
        </div>
      </div>
      <Link className="btn btn-cream shrink-0" href="/demo?plan=company">Request a team quote</Link>
    </div>
  );
}
