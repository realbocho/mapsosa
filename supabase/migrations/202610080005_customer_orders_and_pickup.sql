alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists cancellation_requested_at timestamptz;

alter table public.pickup_passes
  add column if not exists item_snapshot jsonb not null default '[]'::jsonb;

alter table public.order_items
  add column if not exists proposed_quantity integer check (proposed_quantity >= 0);

create table if not exists public.payment_settings (
  singleton boolean primary key default true check (singleton),
  bank_name text not null,
  account_number text not null,
  account_holder text not null,
  memo text not null default '주문자 이름으로 입금해 주세요.',
  updated_at timestamptz not null default now()
);
alter table public.payment_settings enable row level security;
drop policy if exists "payment account is public" on public.payment_settings;
create policy "payment account is public" on public.payment_settings for select to anon, authenticated using (true);
drop policy if exists "operators manage payment account" on public.payment_settings;
create policy "operators manage payment account" on public.payment_settings for all to authenticated using (public.is_operator()) with check (public.is_operator());

alter table public.orders
  add column if not exists payment_bank text,
  add column if not exists payment_account text,
  add column if not exists payment_account_holder text;

alter table public.store_transfers
  add column if not exists pickup_date date;
alter table public.store_transfers alter column round_id drop not null;

create index if not exists orders_pickup_date_idx on public.orders(pickup_date, status);

create or replace function public.product_order_totals(p_pickup_date date)
returns table (product_id uuid, applied_quantity bigint, paid_quantity bigint, awaiting_payment_quantity bigint)
language sql stable security definer set search_path = '' as $$
  select oi.product_id,
    sum(case when o.paid_at is not null or o.status in ('paid_recruiting', 'slot_confirmed', 'store_checking', 'partially_refunded', 'pickup_ready', 'picked_up', 'auto_completed') then
      case when o.status in ('partially_refunded', 'pickup_ready', 'picked_up', 'auto_completed') and oi.confirmed_quantity is not null then oi.confirmed_quantity else oi.quantity end
      else 0 end)::bigint,
    sum(case when o.paid_at is not null or o.status in ('paid_recruiting', 'slot_confirmed', 'store_checking', 'partially_refunded', 'pickup_ready', 'picked_up', 'auto_completed') then
      case when o.status in ('partially_refunded', 'pickup_ready', 'picked_up', 'auto_completed') and oi.confirmed_quantity is not null then oi.confirmed_quantity else oi.quantity end
      else 0 end)::bigint,
    sum(case when o.status = 'awaiting_payment' then oi.quantity else 0 end)::bigint
  from public.orders o join public.order_items oi on oi.order_id = o.id
  where o.pickup_date = p_pickup_date and o.status in ('awaiting_payment', 'paid_recruiting', 'slot_confirmed', 'store_checking', 'partially_refunded', 'pickup_ready', 'picked_up', 'auto_completed')
  group by oi.product_id;
$$;

revoke all on function public.product_order_totals(date) from public;
grant execute on function public.product_order_totals(date) to anon, authenticated;

drop function if exists public.create_order(date, public.refund_preference, text, text, text, text, jsonb);

create function public.create_order(
  p_pickup_date date,
  p_refund_preference public.refund_preference,
  p_refund_bank text,
  p_refund_account text,
  p_refund_account_holder text,
  p_depositor_name text,
  p_items jsonb
) returns table (order_id uuid, order_number text, total integer, payment_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_due_at timestamptz := now() + interval '1 hour';
  v_deadline timestamptz;
  v_payment public.payment_settings%rowtype;
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_pickup_date is null or p_pickup_date < (now() at time zone 'Asia/Seoul')::date or extract(isodow from p_pickup_date) not in (3, 6) then
    raise exception '수요일 또는 토요일 픽업 날짜를 선택해주세요.' using errcode = '22023';
  end if;
  v_deadline := ((p_pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul';
  if now() >= v_deadline then raise exception '주문 마감이 지났어요. 다음 픽업 날짜를 선택해주세요.' using errcode = '22023'; end if;
  if length(trim(p_refund_bank)) = 0 or length(trim(p_refund_account)) < 5 or length(trim(p_refund_account_holder)) = 0 or length(trim(p_depositor_name)) = 0 then
    raise exception '환불 계좌와 입금자 정보를 입력해주세요.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception '주문 상품을 확인해주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception '주문 상품을 확인해주세요.' using errcode = '22023';
  end if;
  select * into v_payment from public.payment_settings where singleton = true;
  if not found or length(trim(coalesce(v_payment.account_number, ''))) = 0 then
    raise exception '입금 계좌 설정이 완료되지 않아 주문을 접수할 수 없어요.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 100 then raise exception '상품 수량을 확인해주세요.' using errcode = '22023'; end if;
    select p.* into v_product
    from public.products p join public.stores s on s.id = p.store_id
    where p.id = (v_item ->> 'product_id')::uuid and p.active = true and s.active = true
      and not ((extract(dow from p_pickup_date)::smallint) = any(s.closed_weekdays));
    if not found then raise exception '선택한 픽업일에 주문할 수 없는 상품이 있어요.' using errcode = '22023'; end if;
    v_subtotal := v_subtotal + v_product.consumer_price * v_quantity;
  end loop;

  insert into public.orders (user_id, pickup_date, refund_preference, refund_bank, refund_account, refund_account_holder, depositor_name, subtotal, total, payment_due_at, payment_bank, payment_account, payment_account_holder)
  values (v_user_id, p_pickup_date, p_refund_preference, trim(p_refund_bank), trim(p_refund_account), trim(p_refund_account_holder), trim(p_depositor_name), v_subtotal, v_subtotal, v_due_at, v_payment.bank_name, v_payment.account_number, v_payment.account_holder)
  returning id, orders.order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and active = true;
    insert into public.order_items (order_id, product_id, quantity, unit_price)
    values (v_order_id, v_product.id, v_quantity, v_product.consumer_price);
  end loop;

  return query select v_order_id, v_order_number, v_subtotal, v_due_at;
end;
$$;

revoke all on function public.create_order(date, public.refund_preference, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_order(date, public.refund_preference, text, text, text, text, jsonb) to authenticated;

create or replace function public.cancel_my_order(p_order_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception '주문을 찾을 수 없어요.' using errcode = 'P0002'; end if;
  if v_order.status = 'awaiting_payment' and v_order.paid_at is null then
    update public.orders set status = 'cancelled_unpaid', cancelled_at = now(), cancel_reason = 'customer_cancelled', updated_at = now() where id = p_order_id;
    return 'cancelled';
  end if;
  if v_order.status in ('cancelled_unpaid', 'refunded', 'picked_up', 'auto_completed') then
    raise exception '이미 취소되었거나 종료된 주문입니다.' using errcode = '22023';
  end if;
  update public.orders set cancellation_requested_at = coalesce(cancellation_requested_at, now()), updated_at = now() where id = p_order_id;
  return 'requested';
end;
$$;

revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;

create or replace function public.complete_my_pickup(p_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.orders set status = 'picked_up', updated_at = now()
  where id = p_order_id and user_id = auth.uid() and status = 'pickup_ready';
  if not found then raise exception '픽업 완료 처리할 수 없는 주문입니다.' using errcode = '22023'; end if;
  update public.pickup_passes set completed_at = now() where order_id = p_order_id and completed_at is null;
end;
$$;

revoke all on function public.complete_my_pickup(uuid) from public, anon;
grant execute on function public.complete_my_pickup(uuid) to authenticated;

create or replace function public.finalize_order_for_pickup(
  p_order_id uuid,
  p_confirmed_items jsonb,
  p_refund_reason public.refund_reason default 'quantity_unavailable',
  p_refund_message text default '주문하신 수량을 모두 확보하기 어려워 일부 금액을 환불합니다.'
) returns table (final_status public.order_status, refund_total integer, confirmed_total integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_item jsonb;
  v_line public.order_items%rowtype;
  v_confirmed integer;
  v_has_shortage boolean := false;
  v_refund integer := 0;
  v_confirmed_count integer := 0;
  v_snapshot jsonb;
  v_status public.order_status;
  v_auto_complete_at timestamptz;
begin
  if not public.is_operator() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없어요.' using errcode = 'P0002'; end if;
  if v_order.status not in ('paid_recruiting', 'slot_confirmed', 'store_checking') then
    raise exception '입금 확인 후 청과점 확인 단계에서 확정할 수 있어요.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_confirmed_items), 'null') <> 'array' then raise exception '확정 수량을 확인해주세요.' using errcode = '22023'; end if;

  for v_line in select * from public.order_items where order_id = p_order_id for update loop
    v_confirmed := 0;
    select greatest(0, least(v_line.quantity, (entries.value ->> 'confirmed_quantity')::integer)) into v_confirmed
      from jsonb_array_elements(p_confirmed_items) as entries(value) where entries.value ->> 'order_item_id' = v_line.id::text limit 1;
    v_confirmed := coalesce(v_confirmed, 0);
    if v_confirmed < v_line.quantity then v_has_shortage := true; end if;
    update public.order_items set confirmed_quantity = v_confirmed, refund_quantity = v_line.quantity - v_confirmed,
      refund_reason = case when v_confirmed < v_line.quantity then p_refund_reason else null end where id = v_line.id;
  end loop;

  if v_order.refund_preference = 'all_or_nothing' and v_has_shortage then
    update public.order_items set confirmed_quantity = 0, refund_quantity = quantity, refund_reason = p_refund_reason where order_id = p_order_id;
  end if;

  select coalesce(sum(oi.refund_quantity * oi.unit_price), 0), coalesce(sum(coalesce(oi.confirmed_quantity, 0)), 0)
    into v_refund, v_confirmed_count from public.order_items oi where oi.order_id = p_order_id;
  if v_refund > 0 then
    insert into public.refunds (order_id, reason, amount, message)
    values (p_order_id, p_refund_reason, v_refund, case when v_order.refund_preference = 'all_or_nothing' and v_has_shortage then '일부 품목을 준비하지 못해 주문 전체를 환불합니다.' else p_refund_message end);
  end if;

  if v_confirmed_count > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'specification', p.specification, 'quantity', oi.confirmed_quantity) order by oi.created_at), '[]'::jsonb)
      into v_snapshot from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = p_order_id and oi.confirmed_quantity > 0;
    select max((v_order.pickup_date + next_open.day_offset)::timestamp + s.closing_time) at time zone 'Asia/Seoul'
      into v_auto_complete_at
      from public.order_items oi join public.products p on p.id = oi.product_id join public.stores s on s.id = p.store_id
      cross join lateral (
        select day_offset::integer as day_offset from generate_series(1, 7) as offsets(day_offset)
        where not (extract(dow from (v_order.pickup_date + day_offset::integer))::smallint = any(s.closed_weekdays))
        order by day_offset limit 1
      ) next_open
      where oi.order_id = p_order_id and oi.confirmed_quantity > 0;
    insert into public.pickup_passes (order_id, item_snapshot, auto_complete_at)
      values (p_order_id, v_snapshot, coalesce(v_auto_complete_at, ((v_order.pickup_date + 1)::timestamp + time '20:00') at time zone 'Asia/Seoul'))
      on conflict (order_id) do update set item_snapshot = excluded.item_snapshot;
    v_status := 'pickup_ready';
  else
    v_status := 'refunded';
  end if;
  update public.orders set status = v_status, updated_at = now() where id = p_order_id;
  return query select v_status, v_refund, v_confirmed_count;
end;
$$;

revoke all on function public.finalize_order_for_pickup(uuid, jsonb, public.refund_reason, text) from public, anon, authenticated;
grant execute on function public.finalize_order_for_pickup(uuid, jsonb, public.refund_reason, text) to authenticated;

create or replace function public.complete_expired_pickups() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.orders o set status = 'auto_completed', updated_at = now()
  where o.status = 'pickup_ready' and exists (
    select 1 from public.pickup_passes pp where pp.order_id = o.id and pp.completed_at is null and pp.auto_complete_at <= now()
  );
  get diagnostics v_count = row_count;
  update public.pickup_passes pp set completed_at = now()
  from public.orders o where pp.order_id = o.id and o.status = 'auto_completed' and pp.completed_at is null;
  return v_count;
end;
$$;

revoke all on function public.complete_expired_pickups() from public, anon, authenticated;
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'mapsosa-auto-complete-pickups';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('mapsosa-auto-complete-pickups', '* * * * *', 'select public.complete_expired_pickups();');
end;
$$;
