-- TapSynk India | Fresh Supabase project
-- Paste this entire file into Supabase Dashboard > SQL Editor > New query and run it once.
-- Includes migrations 0001 through 0012 and Data API grants for new Supabase projects.
-- Stripe, Google, email and application environment variables are configured separately.

begin;

do $fresh_install$
declare
  existing_table text;
begin
  select name into existing_table
  from unnest(array[
    'profiles', 'cards', 'ai_agents', 'appointments', 'subscriptions', 'orders',
    'rate_limits', 'companies', 'leads', 'card_events', 'demo_requests',
    'payment_confirmation_emails', 'google_calendar_connections', 'notifications',
    'link_clicks', 'india_stripe_customers', 'personal_card_access'
  ]) as tables(name)
  where to_regclass('public.' || name) is not null
  limit 1;
  if existing_table is not null then
    raise exception 'TapSynk setup stopped because public.% already exists. Use the missing migrations for an existing installation.', existing_table;
  end if;
end;
$fresh_install$;

-- Migration 0001_init.sql
-- TapSync schema: run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists "pgcrypto";

-- ───────────────────────── profiles ─────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── cards ─────────────────────────
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  full_name text not null default '' check (char_length(full_name) <= 80),
  job_title text not null default '' check (char_length(job_title) <= 80),
  company text not null default '' check (char_length(company) <= 80),
  bio text not null default '' check (char_length(bio) <= 400),
  email text not null default '' check (char_length(email) <= 120),
  phone text not null default '' check (char_length(phone) <= 40),
  website text not null default '' check (char_length(website) <= 200),
  address text not null default '' check (char_length(address) <= 200),
  avatar_url text not null default '',
  logo_url text not null default '',
  accent text not null default '#2563EB' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  socials jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  first_printed_at timestamptz,
  views integer not null default 0,
  saves integer not null default 0,
  ai_opens integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── AI agents ─────────────────────────
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null unique references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  business_name text not null default '',
  description text not null default '' check (char_length(description) <= 4000),
  services text not null default '' check (char_length(services) <= 4000),
  faq text not null default '' check (char_length(faq) <= 6000),
  tone text not null default 'friendly' check (tone in ('friendly', 'professional', 'enthusiastic', 'concise')),
  website_url text not null default '',
  knowledge text not null default '' check (char_length(knowledge) <= 30000),
  knowledge_updated_at timestamptz,
  booking_enabled boolean not null default true,
  timezone text not null default 'UTC',
  work_days int[] not null default '{1,2,3,4,5}',
  day_start time not null default '09:00',
  day_end time not null default '17:00',
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 45, 60, 90)),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── appointments ─────────────────────────
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) <= 120),
  phone text not null default '' check (char_length(phone) <= 40),
  notes text not null default '' check (char_length(notes) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed')),
  created_at timestamptz not null default now()
);
-- Never double-book a confirmed slot on the same card.
create unique index if not exists appointments_no_double_booking
  on public.appointments (card_id, starts_at) where status = 'confirmed';

-- ───────────────────────── billing ─────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  tier text not null check (tier in ('virtual', 'ai')),
  billing_interval text not null check (billing_interval in ('month', 'quarter', 'year')),
  status text not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_session_id text not null unique,
  receipt_number text not null,
  tier text not null,
  billing_interval text not null,
  amount_subtotal integer not null default 0,
  amount_discount integer not null default 0,
  amount_tax integer not null default 0,
  amount_total integer not null default 0,
  currency text not null default 'usd',
  card_brand text,
  card_last4 text,
  shipping_name text,
  shipping_address jsonb,
  fulfillment_status text not null default 'processing'
    check (fulfillment_status in ('processing', 'printing', 'shipped', 'delivered')),
  created_at timestamptz not null default now()
);

-- ───────────────────────── rate limiting ─────────────────────────
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

create or replace function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;

-- Public card counters (views / contact saves / AI opens).
create or replace function public.bump_card_stat(p_slug text, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'view' then
    update public.cards set views = views + 1 where slug = p_slug and published;
  elsif p_kind = 'save' then
    update public.cards set saves = saves + 1 where slug = p_slug and published;
  elsif p_kind = 'ai' then
    update public.cards set ai_opens = ai_opens + 1 where slug = p_slug and published;
  end if;
end;
$$;
revoke all on function public.bump_card_stat(text, text) from public, anon, authenticated;

-- ───────────────────────── row level security ─────────────────────────
alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.ai_agents enable row level security;
alter table public.appointments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.orders enable row level security;
alter table public.rate_limits enable row level security;

create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Owners manage their card; anyone may read a published card.
create policy "own card all" on public.cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "published cards are public" on public.cards for select using (published);

-- Agent config is private; the public chat reads it server-side with the service role.
create policy "own agent all" on public.ai_agents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Visitors book through the server (service role); owners read and update.
create policy "own appointments read" on public.appointments for select using (auth.uid() = owner_id);
create policy "own appointments update" on public.appointments for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Billing rows are written only by the Stripe webhook (service role).
create policy "own subscription read" on public.subscriptions for select using (auth.uid() = user_id);
create policy "own orders read" on public.orders for select using (auth.uid() = user_id);

-- ───────────────────────── storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-assets', 'card-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "card assets public read" on storage.objects for select using (bucket_id = 'card-assets');
create policy "card assets owner write" on storage.objects for insert
  with check (bucket_id = 'card-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card assets owner update" on storage.objects for update
  using (bucket_id = 'card-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card assets owner delete" on storage.objects for delete
  using (bucket_id = 'card-assets' and (storage.foldername(name))[1] = auth.uid()::text);

-- Migration 0002_trial_leads_companies.sql
-- TapSync v2: free first month, lead capture, analytics events and Company plans.
-- Run once in the Supabase SQL editor after 0001_init.sql.

-- ───────────────────────── free trial ─────────────────────────
-- One free month per account, recorded when the first trial starts.
alter table public.profiles add column if not exists trial_used_at timestamptz;

-- ───────────────────────── companies ─────────────────────────
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  website text not null default '' check (char_length(website) <= 200),
  address text not null default '' check (char_length(address) <= 200),
  logo_url text not null default '',
  accent text not null default '#1d5bff' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  tier text not null default 'virtual' check (tier in ('virtual', 'ai')),
  seats integer not null default 5 check (seats between 2 and 500),
  -- Billing fields are written only by the server (Stripe webhook / service role).
  status text not null default 'incomplete',
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.companies enable row level security;
drop policy if exists "own company read" on public.companies;
create policy "own company read" on public.companies for select using (auth.uid() = owner_id);

-- Cards can now belong to a company. A person still has at most one personal card.
alter table public.cards add column if not exists company_id uuid references public.companies (id) on delete cascade;
alter table public.cards drop constraint if exists cards_user_id_key;
create unique index if not exists cards_one_personal_per_user on public.cards (user_id) where company_id is null;
create index if not exists cards_company_idx on public.cards (company_id) where company_id is not null;

-- Owners may only attach cards to their own company, and never beyond the seats they pay for.
create or replace function public.check_company_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_seats int;
  v_used int;
begin
  if new.company_id is null then
    return new;
  end if;
  select owner_id, seats into v_owner, v_seats from public.companies where id = new.company_id;
  if v_owner is null or v_owner <> new.user_id then
    raise exception 'Card does not belong to this company' using errcode = '42501';
  end if;
  select count(*) into v_used from public.cards where company_id = new.company_id and id <> new.id;
  if v_used >= v_seats then
    raise exception 'All company seats are in use' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists cards_company_check on public.cards;
create trigger cards_company_check
  before insert or update of company_id, user_id on public.cards
  for each row execute function public.check_company_card();

-- A company shares one AI agent across all of its employee cards.
alter table public.ai_agents alter column card_id drop not null;
alter table public.ai_agents add column if not exists company_id uuid unique references public.companies (id) on delete cascade;
alter table public.ai_agents drop constraint if exists ai_agents_owner_check;
alter table public.ai_agents add constraint ai_agents_owner_check check ((card_id is null) <> (company_id is null));

-- Orders can cover many company cards.
alter table public.orders add column if not exists company_id uuid references public.companies (id) on delete set null;
alter table public.orders add column if not exists quantity integer not null default 1;

-- ───────────────────────── leads ─────────────────────────
-- Visitors who share their own details back from a card ("exchange contacts").
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  email text not null default '' check (char_length(email) <= 120),
  phone text not null default '' check (char_length(phone) <= 40),
  company text not null default '' check (char_length(company) <= 100),
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  created_at timestamptz not null default now()
);
create index if not exists leads_owner_idx on public.leads (owner_id, created_at desc);
alter table public.leads enable row level security;
drop policy if exists "own leads read" on public.leads;
create policy "own leads read" on public.leads for select using (auth.uid() = owner_id);
drop policy if exists "own leads update" on public.leads;
create policy "own leads update" on public.leads for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "own leads delete" on public.leads;
create policy "own leads delete" on public.leads for delete using (auth.uid() = owner_id);

-- ───────────────────────── analytics events ─────────────────────────
create table if not exists public.card_events (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.cards (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  kind text not null check (kind in ('view', 'save', 'ai', 'lead', 'booking')),
  source text not null default 'link' check (source in ('tap', 'qr', 'link')),
  created_at timestamptz not null default now()
);
create index if not exists card_events_owner_idx on public.card_events (owner_id, created_at desc);
create index if not exists card_events_card_idx on public.card_events (card_id, created_at desc);
alter table public.card_events enable row level security;
drop policy if exists "own events read" on public.card_events;
create policy "own events read" on public.card_events for select using (auth.uid() = owner_id);

-- Counters + a dated event row for charts. p_source: tap (card), qr (QR code) or link.
drop function if exists public.bump_card_stat(text, text);
create or replace function public.bump_card_stat(p_slug text, p_kind text, p_source text default 'link')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  select * into v_card from public.cards where slug = p_slug and published;
  if not found then
    return;
  end if;
  if p_kind = 'view' then
    update public.cards set views = views + 1 where id = v_card.id;
  elsif p_kind = 'save' then
    update public.cards set saves = saves + 1 where id = v_card.id;
  elsif p_kind = 'ai' then
    update public.cards set ai_opens = ai_opens + 1 where id = v_card.id;
  elsif p_kind not in ('lead', 'booking') then
    return;
  end if;
  insert into public.card_events (card_id, owner_id, company_id, kind, source)
  values (v_card.id, v_card.user_id, v_card.company_id, p_kind,
          case when p_source in ('tap', 'qr', 'link') then p_source else 'link' end);
end;
$$;
revoke all on function public.bump_card_stat(text, text, text) from public, anon, authenticated;

-- ───────────────────────── tighter agent ownership ─────────────────────────
-- An agent row may only point at the caller's own card or own company.
drop policy if exists "own agent all" on public.ai_agents;
create policy "own agent all" on public.ai_agents for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (card_id is null or exists (select 1 from public.cards c where c.id = card_id and c.user_id = auth.uid()))
    and (company_id is null or exists (select 1 from public.companies co where co.id = company_id and co.owner_id = auth.uid()))
  );

-- Migration 0003_plan_switch_demos_lead_notes.sql
-- TapSync v3: scheduled plan switches, lead notes and "Book a demo" requests.
-- Run once in the Supabase SQL editor after 0002_trial_leads_companies.sql.

-- ───────────────────────── plan switches ─────────────────────────
-- Moving from AI Card to Virtual Card waits until the paid period ends, so the
-- customer keeps AI until then. The pending switch is mirrored here for the UI.
alter table public.subscriptions add column if not exists pending_tier text check (pending_tier in ('virtual', 'ai'));
alter table public.subscriptions add column if not exists pending_interval text check (pending_interval in ('month', 'quarter', 'year'));
alter table public.subscriptions add column if not exists pending_change_at timestamptz;
alter table public.subscriptions add column if not exists stripe_schedule_id text;

-- ───────────────────────── lead notes ─────────────────────────
alter table public.leads add column if not exists notes text not null default '' check (char_length(notes) <= 2000);
alter table public.leads add column if not exists updated_at timestamptz not null default now();
create index if not exists leads_company_idx on public.leads (company_id, created_at desc) where company_id is not null;

-- ───────────────────────── demo requests ─────────────────────────
-- Filled in from the public "Book a demo" page. Only the server (service role) reads and
-- writes this table, so it has row-level security on and no policies for signed-in users.
create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 3 and 120),
  phone text not null default '' check (char_length(phone) <= 40),
  company text not null default '' check (char_length(company) <= 100),
  role text not null default '' check (char_length(role) <= 80),
  team_size text not null default '1' check (team_size in ('1', '2-9', '10-24', '25-99', '100+')),
  interest text not null default 'not_sure' check (interest in ('virtual', 'ai', 'company', 'not_sure')),
  preferred_date date,
  preferred_time text not null default '' check (preferred_time in ('', 'morning', 'afternoon', 'evening')),
  timezone text not null default '' check (char_length(timezone) <= 60),
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'scheduled', 'done', 'not_a_fit')),
  created_at timestamptz not null default now()
);
create index if not exists demo_requests_created_idx on public.demo_requests (created_at desc);
alter table public.demo_requests enable row level security;

-- Migration 0004_ai_voice.sql
-- TapSync 0004: storage for the AI's spoken greetings (Gemini voice).
-- Run once in the Supabase SQL editor after 0001–0003. Safe to run again.
-- Only the server (service role) writes here; anyone can play the greeting audio.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-voice', 'ai-voice', true, 5242880, array['audio/mpeg', 'audio/wav', 'audio/ogg', 'text/plain'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ai voice public read" on storage.objects;
create policy "ai voice public read" on storage.objects for select using (bucket_id = 'ai-voice');

-- Migration 0005_appointment_confirmation.sql
-- Historical bookings are not emailed retroactively. New bookings explicitly queue mail.
alter table public.appointments
  add column if not exists booking_language text not null default 'unknown',
  add column if not exists confirmation_email_status text not null default 'not_requested'
    check (confirmation_email_status in ('not_requested', 'pending', 'sending', 'sent', 'failed')),
  add column if not exists confirmation_email_sent_at timestamptz;
create index if not exists appointments_pending_confirmation
  on public.appointments (created_at) where confirmation_email_status = 'pending';

-- Migration 0006_payment_confirmation.sql
-- One durable email record per paid Stripe invoice, shared across webhook retries.
create table if not exists public.payment_confirmation_emails (
  stripe_invoice_id text primary key,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.payment_confirmation_emails enable row level security;
-- Only the service-role webhook can read or modify delivery records.
revoke all on public.payment_confirmation_emails from anon, authenticated;

-- Migration 0007_calendar_and_signup.sql
-- Duplicate signup checks are available only to trusted server code.
create or replace function public.account_email_exists(candidate text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.users where lower(email) = lower(trim(candidate))); $$;
revoke all on function public.account_email_exists(text) from public, anon, authenticated;
grant execute on function public.account_email_exists(text) to service_role;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_encrypted text not null,
  granted_scope text not null,
  connected_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.google_calendar_connections enable row level security;
-- Tokens are never readable by browsers, including the account owner.
revoke all on public.google_calendar_connections from anon, authenticated;
grant all on public.google_calendar_connections to service_role;

alter table public.appointments
  add column if not exists google_event_id text,
  add column if not exists google_meet_url text,
  add column if not exists google_event_version integer not null default 1,
  add column if not exists calendar_sync_status text not null default 'pending'
    check (calendar_sync_status in ('pending', 'synced', 'failed', 'disconnected')),
  add column if not exists calendar_sync_error text;

-- Reopened bookings get a fresh Google event ID; deleted Calendar events cannot
-- safely reuse the ID of an earlier cancelled event.
create or replace function public.queue_calendar_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    new.calendar_sync_status := 'pending';
    new.calendar_sync_error := null;
    if old.status = 'cancelled' and new.status = 'confirmed' then
      new.google_event_version := old.google_event_version + 1;
      new.google_event_id := null;
      new.google_meet_url := null;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists appointments_queue_calendar on public.appointments;
create trigger appointments_queue_calendar before update on public.appointments
  for each row execute function public.queue_calendar_change();
create index if not exists appointments_calendar_pending on public.appointments(owner_id, starts_at)
  where calendar_sync_status in ('pending', 'failed');

-- Migration 0008_owner_notifications.sql
-- Persistent activity inbox + owner email outbox. Only future inserts notify.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null check (kind in ('lead', 'appointment')),
  entity_id uuid not null,
  title text not null,
  body text not null,
  href text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_status text not null default 'pending' check (email_status in ('pending', 'sending', 'sent', 'failed', 'uncertain')),
  email_error text,
  email_sent_at timestamptz,
  email_started_at timestamptz,
  unique (kind, entity_id)
);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
create policy "owners read notifications" on public.notifications for select to authenticated using (auth.uid() = owner_id);
create policy "owners mark notifications read" on public.notifications for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index notifications_owner_recent on public.notifications(owner_id, created_at desc);
create index notifications_owner_unread on public.notifications(owner_id, kind) where read_at is null;
create index notifications_pending_email on public.notifications(owner_id, created_at) where email_status = 'pending';

create or replace function public.notify_card_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare card_name text; company uuid; notification_kind text;
begin
  select c.full_name, c.company_id into card_name, company from public.cards c where c.id = new.card_id;
  notification_kind := case when tg_table_name = 'leads' then 'lead' else 'appointment' end;
  insert into public.notifications(owner_id, company_id, kind, entity_id, title, body, href)
  values (new.owner_id, company, notification_kind, new.id,
    case when notification_kind = 'lead' then 'New lead' else 'New appointment' end,
    left(new.name, 100) || case when notification_kind = 'lead' then ' shared their contact with ' else ' booked a meeting with ' end || coalesce(card_name, 'you') || '.',
    case when notification_kind = 'appointment' then '/dashboard/appointments' when company is not null then '/dashboard/company/leads' else '/dashboard/leads' end)
  on conflict (kind, entity_id) do nothing;
  return new;
end; $$;
revoke all on function public.notify_card_owner() from public, anon, authenticated;
grant execute on function public.notify_card_owner() to service_role;
create trigger leads_notify_owner after insert on public.leads for each row execute function public.notify_card_owner();
create trigger appointments_notify_owner after insert on public.appointments for each row execute function public.notify_card_owner();

-- Realtime delivery is optional; the dashboard also polls as a fallback.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end; $$;

-- The linked Google identity is shown to the owner; tokens stay server-only.
alter table public.google_calendar_connections
  add column if not exists google_email text,
  add column if not exists calendar_summary text not null default 'Primary calendar',
  add column if not exists meet_enabled boolean not null default true;

-- Migration 0009_employee_access.sql
-- Employees sign up using the work email on their company card and verify it.
-- Keep card ownership, billing and the shared agent with the company owner.

create or replace function public.employee_card_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select c.id
  from public.cards c
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and u.email is not null
    and c.company_id is not null
    and lower(btrim(c.email)) = lower(btrim(u.email));
$$;
revoke all on function public.employee_card_ids() from public, anon;
grant execute on function public.employee_card_ids() to authenticated;

drop policy if exists "employee own card read" on public.cards;
create policy "employee own card read" on public.cards for select to authenticated
using (id in (select public.employee_card_ids()));

drop policy if exists "employee own leads read" on public.leads;
create policy "employee own leads read" on public.leads for select to authenticated
using (card_id in (select public.employee_card_ids()));

drop policy if exists "employee own appointments read" on public.appointments;
create policy "employee own appointments read" on public.appointments for select to authenticated
using (card_id in (select public.employee_card_ids()));

-- No employee UPDATE/DELETE policies: personal fields are written by an
-- authenticated server action with a fixed whitelist. Company settings stay private.
create index if not exists cards_employee_email_idx
  on public.cards (lower(btrim(email))) where company_id is not null;


-- Migration 0010_link_clicks.sql
-- Outbound profile clicks are separate from existing card view/save metrics.
create table public.link_clicks (
  id uuid primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  link_id text not null check (char_length(link_id) between 1 and 80),
  link_label text not null check (char_length(link_label) between 1 and 100),
  link_url text not null check (char_length(link_url) between 1 and 2048),
  clicked_at timestamptz not null default clock_timestamp(),
  source text not null default 'unknown' check (source in ('nfc', 'qr', 'link', 'unknown')),
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  user_agent text check (char_length(user_agent) <= 512),
  referrer text check (char_length(referrer) <= 512)
);
create index link_clicks_card_time_idx on public.link_clicks(card_id, clicked_at desc);
create index link_clicks_dedupe_idx on public.link_clicks(card_id, link_id, visitor_hash, clicked_at desc);
alter table public.link_clicks enable row level security;
revoke all on public.link_clicks from anon, authenticated;
grant select on public.link_clicks to authenticated;
grant all on public.link_clicks to service_role;
-- Derive access from current ownership, never from publicly readable card status.
create policy "card owners and company managers read link clicks"
on public.link_clicks for select to authenticated using (
  exists (select 1 from public.cards c where c.id = card_id and (
    c.user_id = auth.uid() or exists (
      select 1 from public.companies co where co.id = c.company_id and co.owner_id = auth.uid()
    )
  ))
);

create function public.record_link_click(
  p_event_id uuid, p_card_id uuid, p_link_id text, p_link_label text, p_link_url text,
  p_source text, p_visitor_hash text, p_user_agent text, p_referrer text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.cards where id = p_card_id and published) then return false; end if;
  -- Serializes only this visitor/link. Suppression works across server instances.
  perform pg_advisory_xact_lock(hashtextextended(p_card_id::text || ':' || p_link_id || ':' || p_visitor_hash, 0));
  if exists(select 1 from public.link_clicks where card_id = p_card_id and link_id = p_link_id
    and visitor_hash = p_visitor_hash and clicked_at > clock_timestamp() - interval '2 seconds') then return false; end if;
  insert into public.link_clicks(id, card_id, link_id, link_label, link_url, source, visitor_hash, user_agent, referrer)
  values(p_event_id, p_card_id, p_link_id, p_link_label, p_link_url, p_source, p_visitor_hash, p_user_agent, p_referrer)
  on conflict(id) do nothing;
  return found;
end;
$$;
revoke all on function public.record_link_click(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_link_click(uuid, uuid, text, text, text, text, text, text, text) to service_role;

-- One JSON result avoids PostgREST's row limit truncating large team reports.
-- SECURITY INVOKER is essential: the caller's SELECT policy applies to every row.
create function public.link_click_totals(p_card_ids uuid[], p_since timestamptz default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select card_id, link_id, link_url, count(*) as clicks
    from public.link_clicks
    where card_id = any(p_card_ids) and (p_since is null or clicked_at >= p_since)
    group by card_id, link_id, link_url
  ) t;
$$;
revoke all on function public.link_click_totals(uuid[], timestamptz) from public, anon;
grant execute on function public.link_click_totals(uuid[], timestamptz) to authenticated;

-- Migration 0011_india_personal_billing.sql
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

-- Data API privileges for the tables that previously relied on Supabase defaults.
-- Existing row-level security policies still control access to individual rows.
revoke all on table public.profiles, public.cards, public.ai_agents, public.appointments,
  public.subscriptions, public.orders, public.rate_limits, public.companies,
  public.leads, public.card_events, public.demo_requests, public.payment_confirmation_emails
  from public, anon, authenticated;

grant select on table public.cards to anon;
grant select, update on table public.profiles, public.appointments to authenticated;
grant select, insert, update, delete on table public.cards, public.ai_agents to authenticated;
grant select, update, delete on table public.leads to authenticated;
grant select on table public.subscriptions, public.orders, public.companies, public.card_events to authenticated;

grant select, insert, update, delete on table public.profiles, public.cards, public.ai_agents,
  public.appointments, public.subscriptions, public.orders, public.companies, public.leads,
  public.card_events, public.demo_requests, public.payment_confirmation_emails to service_role;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.bump_card_stat(text, text, text) to service_role;

-- Migration 0012_order_fulfillment.sql
alter table public.orders
  add column if not exists card_printed boolean not null default false,
  add column if not exists nfc_encoded boolean not null default false,
  add column if not exists shipped_at timestamptz,
  add column if not exists tracking_number text not null default '',
  add column if not exists shipping_carrier text not null default '',
  add column if not exists fulfillment_version integer not null default 0;

create table if not exists public.order_fulfillment_notes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  notes text not null check (char_length(notes) <= 1500)
);
alter table public.order_fulfillment_notes enable row level security;
revoke all on public.order_fulfillment_notes from public, anon, authenticated;
grant select, insert, update on public.order_fulfillment_notes to service_role;

-- Retain notes if the earlier, inline-column version of this migration was applied.
do $move_notes$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'fulfillment_notes'
  ) then
    insert into public.order_fulfillment_notes (order_id, notes)
    select id, fulfillment_notes from public.orders where fulfillment_notes <> ''
    on conflict (order_id) do nothing;
    alter table public.orders drop column fulfillment_notes;
  end if;
end;
$move_notes$;

alter table public.orders drop constraint if exists orders_fulfillment_status_check;
alter table public.orders add constraint orders_fulfillment_status_check
  check (fulfillment_status in ('processing', 'printing', 'encoded', 'shipped', 'delivered', 'cancelled'));

update public.orders set card_printed = true, nfc_encoded = true
where fulfillment_status in ('encoded', 'shipped', 'delivered')
  and (not card_printed or not nfc_encoded);

create or replace function public.save_order_fulfillment(p_updates jsonb)
returns table (id uuid, fulfillment_status text, card_printed boolean, nfc_encoded boolean,
  shipped_at timestamptz, tracking_number text, shipping_carrier text,
  fulfillment_notes text, fulfillment_version integer)
language plpgsql security invoker set search_path = ''
as $function$
declare
  affected integer;
begin
  if jsonb_typeof(p_updates) is distinct from 'array'
     or jsonb_array_length(p_updates) not between 1 and 500 then
    raise exception 'Invalid fulfillment updates' using errcode = '22023';
  end if;

  perform o.id
  from public.orders o
  join jsonb_to_recordset(p_updates) as u(id uuid, version integer, patch jsonb) on o.id = u.id
  order by o.id for update of o;

  return query
  with updated as (
    update public.orders o
  set fulfillment_status = coalesce(u.patch->>'status', o.fulfillment_status),
      card_printed = coalesce((u.patch->>'cardPrinted')::boolean, o.card_printed),
      nfc_encoded = coalesce((u.patch->>'nfcEncoded')::boolean, o.nfc_encoded),
      shipped_at = case
        when u.patch->>'status' in ('shipped', 'delivered') then coalesce(o.shipped_at, now())
        when u.patch->>'status' in ('processing', 'printing', 'encoded') then null
        else o.shipped_at
      end,
      tracking_number = coalesce(u.patch->>'trackingNumber', o.tracking_number),
      shipping_carrier = coalesce(u.patch->>'carrier', o.shipping_carrier),
      fulfillment_version = o.fulfillment_version + 1
  from jsonb_to_recordset(p_updates) as u(id uuid, version integer, patch jsonb)
  where o.id = u.id and o.fulfillment_version = u.version
    returning o.id, o.fulfillment_status, o.card_printed, o.nfc_encoded, o.shipped_at,
      o.tracking_number, o.shipping_carrier, o.fulfillment_version
  ), saved_notes as (
    insert into public.order_fulfillment_notes (order_id, notes)
    select updated.id, u.patch->>'notes'
    from updated
    join jsonb_to_recordset(p_updates) as u(id uuid, patch jsonb) on u.id = updated.id
    where u.patch ? 'notes'
    on conflict (order_id) do update set notes = excluded.notes
    returning order_id, notes
  )
  select o.id, o.fulfillment_status, o.card_printed, o.nfc_encoded, o.shipped_at,
    o.tracking_number, o.shipping_carrier, coalesce(saved.notes, previous.notes, ''), o.fulfillment_version
  from updated o
  left join saved_notes saved on saved.order_id = o.id
  left join public.order_fulfillment_notes previous on previous.order_id = o.id;

  get diagnostics affected = row_count;
  if affected <> jsonb_array_length(p_updates) then
    raise exception 'Order changed. Refresh before retrying.' using errcode = '40001';
  end if;
end;
$function$;

revoke all on function public.save_order_fulfillment(jsonb) from public, anon, authenticated;
grant execute on function public.save_order_fulfillment(jsonb) to service_role;
notify pgrst, 'reload schema';

commit;
