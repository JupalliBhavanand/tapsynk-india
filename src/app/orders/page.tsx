import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isFulfillmentAdminEmail, isSupabaseConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";
import { OrdersDashboard } from "./OrdersDashboard";
import { loadOrders } from "./order-data";
import { dayKey } from "./orders";

export const metadata: Metadata = {
  title: "Orders & Fulfillment",
  description: "Review and fulfill smart-card orders with the TapSynk print workspace.",
  robots: { index: false, follow: false },
};

export default async function OrdersPage() {
  if (!isSupabaseConfigured()) return <OrdersMessage text="Configure Supabase to open the orders workspace." />;
  const { user } = await getUser();
  if (!user) redirect("/login?next=%2Forders");
  if (!isFulfillmentAdminEmail(user.email)) notFound();

  const result = await loadOrders().catch(() => null);
  if (!result) return <OrdersMessage text="Could not load orders from Supabase. Check the connection and refresh." />;
  return <OrdersDashboard today={dayKey(new Date())} initialOrders={result.orders} canSave={result.canSave} />;
}

function OrdersMessage({ text }: { text: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold">Orders &amp; Fulfillment</h1>
      <p role="alert" className="mt-4 text-slate-700">{text}</p>
    </main>
  );
}
