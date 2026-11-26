-- A paid India Virtual Card order grants ongoing access alongside any AI subscription.
create table if not exists public.india_stripe_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique
);
alter table public.india_stripe_customers enable row level security;
revoke all on public.india_stripe_customers from public, anon, authenticated;
grant select, insert on public.india_stripe_customers to service_role;

create index if not exists orders_india_virtual_access_idx on public.orders (user_id)
  where company_id is null and tier = 'virtual' and billing_interval = 'once' and currency = 'inr';

create or replace view public.personal_card_access
with (security_invoker = true)
as
with virtual_owners as (
  select distinct user_id from public.orders
  where company_id is null and tier = 'virtual' and billing_interval = 'once'
    and currency = 'inr' and amount_total = 179900
)
select s.user_id, s.tier, s.billing_interval, s.status, s.stripe_customer_id,
       s.stripe_subscription_id, s.current_period_end, s.pending_tier,
       s.pending_interval, s.pending_change_at, s.stripe_schedule_id
from public.subscriptions s
where s.status in ('active', 'trialing', 'past_due')
   or not exists (select 1 from virtual_owners v where v.user_id = s.user_id)
union all
select v.user_id, 'virtual', 'once', 'active', null, null, null, null, null, null, null
from virtual_owners v
where not exists (
  select 1 from public.subscriptions s where s.user_id = v.user_id
    and s.status in ('active', 'trialing', 'past_due')
);

revoke all on public.personal_card_access from public, anon, authenticated;
grant select on public.personal_card_access to authenticated, service_role;
