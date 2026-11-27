begin;

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
