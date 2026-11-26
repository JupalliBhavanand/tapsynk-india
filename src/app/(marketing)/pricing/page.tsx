import type { Metadata } from "next";
import { CompanyPricing } from "@/components/CompanyPricing";
import { PricingTable } from "@/components/PricingTable";

export const metadata: Metadata = {
  title: "Pricing",
  description: "TapSynk India Virtual Card for ₹1,799 one time and AI Card for ₹2,000 per month. Both include free NFC card delivery in India.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <main className="grid-bg">
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="fade-up mb-12 text-center">
          <h1 className="text-5xl font-extrabold tracking-tight">
            TapSynk <span className="text-gradient">India pricing</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-2">Buy the Virtual Card once or get a monthly AI assistant with the AI Card. Both include an NFC smart card and free delivery in India.</p>
        </div>
        <PricingTable />
      </section>
      <section id="company" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-24">
        <CompanyPricing />
      </section>
    </main>
  );
}
