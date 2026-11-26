import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require: (key) => mocks[key] ?? require(key), console });
  return module.exports;
}

const plans = load("src/lib/plans.ts");
let purchased = null;
let subscription = null;
let latest = null;
let confirmed = [];
const sessions = [];
const query = (getData) => {
  const query = Object.fromEntries(["select", "eq", "is", "limit"].map((method) => [method, () => query]));
  query.maybeSingle = async () => ({ data: getData() });
  return query;
};
const { POST } = load("src/app/api/stripe/checkout/route.ts", {
  "@/lib/plans": plans,
  "@/lib/billing": {
    ensureProduct: async (tier) => tier,
    fulfillCheckout: async (id) => confirmed.push(id),
  },
  "@/lib/checkout-error": { checkoutFailure: (error) => { throw error; } },
  "@/lib/env": { SITE_URL: "https://example.com" },
  "@/lib/rate-limit": { rateLimit: async () => true },
  "@/lib/stripe": { stripe: () => ({
    checkout: { sessions: {
      list: async function* () { if (latest) yield latest; },
      create: async (options, config) => {
        sessions.push({ options, config });
        return { url: "https://checkout.stripe.com/test" };
      },
    } },
  }) },
  "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => query(() => ({ stripe_customer_id: "cus_india" })) }) },
  "@/lib/supabase/server": { getUser: async () => ({
    user: { id: "owner", email: "owner@example.com" },
    supabase: { from: (table) => query(() => table === "orders" ? purchased : subscription) },
  }) },
  "@/lib/types": { isActive: (value) => value?.status === "active" },
});

const request = (tier) => POST(new Request("https://example.com/api/stripe/checkout", {
  method: "POST",
  body: JSON.stringify({ tier, interval: "year", amount: 1 }),
}));

assert.equal((await request("virtual")).status, 200);
assert.equal((await request("ai")).status, 200);
const [virtual, ai] = sessions.map(({ options }) => options);
assert.equal(virtual.mode, "payment");
assert.equal(virtual.line_items[0].price_data.recurring, undefined);
assert.equal(virtual.line_items[0].price_data.unit_amount, 179900);
assert.equal(virtual.invoice_creation.invoice_data.metadata.kind, "india_virtual");
assert.equal(ai.mode, "subscription");
assert.equal(ai.line_items[0].price_data.recurring.interval, "month");
assert.equal(ai.line_items[0].price_data.unit_amount, 200000);
for (const session of [virtual, ai]) {
  assert.equal(session.line_items[0].price_data.currency, "inr");
  assert.equal(session.shipping_address_collection.allowed_countries.join(), "IN");
  assert.equal(session.adaptive_pricing.enabled, false);
}
latest = { status: "open", url: "https://checkout.stripe.com/existing", metadata: virtual.metadata };
assert.equal((await (await request("virtual")).json()).url, latest.url);
latest = { id: "cs_virtual", status: "complete", payment_status: "paid", metadata: virtual.metadata };
assert.match((await (await request("virtual")).json()).url, /cs_virtual/);
assert.equal(confirmed.join(), "cs_virtual");
purchased = { id: "order" };
assert.equal((await request("virtual")).status, 409);
subscription = { stripe_subscription_id: "sub_live", status: "active", tier: "ai" };
assert.equal((await request("ai")).status, 409);
assert.equal(sessions.length, 2);

const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.orders (user_id uuid, company_id uuid, tier text, billing_interval text, currency text, amount_total integer);
    create table public.subscriptions (
      user_id uuid primary key, tier text, billing_interval text, status text,
      stripe_customer_id text, stripe_subscription_id text, current_period_end timestamptz,
      pending_tier text, pending_interval text, pending_change_at timestamptz, stripe_schedule_id text
    );
    alter table orders enable row level security;
    alter table subscriptions enable row level security;
    grant select on orders, subscriptions to authenticated, service_role;
    create policy owner_orders on orders for select to authenticated using (user_id::text = current_setting('app.user_id', true));
    create policy owner_subs on subscriptions for select to authenticated using (user_id::text = current_setting('app.user_id', true));
  `);
  const migration = readFileSync("supabase/migrations/0011_india_personal_billing.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const owner = "00000000-0000-0000-0000-000000000001";
  const other = "00000000-0000-0000-0000-000000000002";
  await db.exec(`
    insert into orders values
      ('${owner}', null, 'virtual', 'once', 'inr', 179900),
      ('${owner}', null, 'virtual', 'once', 'inr', 179900),
      ('${other}', null, 'virtual', 'once', 'inr', 1);
    insert into subscriptions (user_id, tier, billing_interval, status) values
      ('${owner}', 'ai', 'month', 'active'),
      ('${other}', 'virtual', 'year', 'trialing');
    set role authenticated;
    set app.user_id = '${owner}';
  `);
  const access = async () => (await db.query("select tier, billing_interval from personal_card_access")).rows;
  assert.deepEqual(await access(), [{ tier: "ai", billing_interval: "month" }]);
  await db.exec(`reset role; update subscriptions set status = 'canceled' where user_id = '${owner}'; set role authenticated;`);
  assert.deepEqual(await access(), [{ tier: "virtual", billing_interval: "once" }]);
  await assert.rejects(db.query("select * from india_stripe_customers"), /permission denied/);
  await db.exec("reset role; set role anon;");
  await assert.rejects(db.query("select * from personal_card_access"), /permission denied/);
} finally {
  await db.close();
}

console.log("India billing: exact INR offers, checkout retries, one-time access after AI cancellation and owner isolation passed.");
