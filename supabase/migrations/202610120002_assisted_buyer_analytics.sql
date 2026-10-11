-- Track assisted orders against the person buying, not the operator account.
alter table public.orders
  add column if not exists order_source text not null default 'direct',
  add column if not exists assisted_customer_id uuid;

update public.orders o
set order_source = 'legacy_operator'
from public.profiles p
where p.id = o.user_id and p.role = 'operator' and o.order_source = 'direct';

alter table public.orders drop constraint if exists orders_order_source_check;
alter table public.orders add constraint orders_order_source_check
  check (order_source in ('direct', 'assisted', 'legacy_operator'));

create table if not exists public.assisted_customers (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  normalized_phone text not null unique,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  acquisition_channel text check (acquisition_channel in ('friend_referral', 'kakao_group', 'search', 'social_community', 'paid_ad', 'store_offline', 'other', 'unknown')),
  created_at timestamptz not null default now(),
  last_order_at timestamptz not null default now()
);
alter table public.assisted_customers enable row level security;
drop policy if exists "operators read assisted customers" on public.assisted_customers;
create policy "operators read assisted customers" on public.assisted_customers
  for select to authenticated using (public.is_operator());
revoke all on public.assisted_customers from anon, authenticated;
grant select on public.assisted_customers to authenticated;

alter table public.orders drop constraint if exists orders_assisted_customer_source_check;
alter table public.orders add constraint orders_assisted_customer_source_check
  check (assisted_customer_id is null or order_source = 'assisted');
alter table public.orders drop constraint if exists orders_assisted_customer_id_fkey;
alter table public.orders add constraint orders_assisted_customer_id_fkey
  foreign key (assisted_customer_id) references public.assisted_customers(id) on delete set null;
create index if not exists orders_assisted_customer_paid_idx
  on public.orders(assisted_customer_id, paid_at) where assisted_customer_id is not null;

create or replace function public.create_assisted_order(
  p_pickup_date date,
  p_customer_phone text,
  p_linked_profile_id uuid,
  p_acquisition_channel text,
  p_refund_preference public.refund_preference,
  p_refund_bank text,
  p_refund_account text,
  p_refund_account_holder text,
  p_depositor_name text,
  p_items jsonb
) returns table (order_id uuid, order_number text, total integer, payment_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_operator_id uuid := auth.uid();
  v_phone text := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), '');
  v_customer_id uuid;
  v_linked_profile_id uuid;
  v_channel text := nullif(trim(coalesce(p_acquisition_channel, '')), '');
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_due_at timestamptz := now();
  v_deadline timestamptz;
  v_payment public.payment_settings%rowtype;
begin
  if v_operator_id is null or not public.is_operator() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if v_phone is null or length(v_phone) not in (10, 11) then
    raise exception '구매자의 휴대폰 번호를 확인해 주세요.' using errcode = '22023';
  end if;
  if v_channel is not null and v_channel not in ('friend_referral', 'kakao_group', 'search', 'social_community', 'paid_ad', 'store_offline', 'other', 'unknown') then
    raise exception '유입 경로를 확인해 주세요.' using errcode = '22023';
  end if;
  if p_pickup_date is null or p_pickup_date < (now() at time zone 'Asia/Seoul')::date or extract(isodow from p_pickup_date) not in (3, 6) then
    raise exception '수요일 또는 토요일 픽업 날짜를 선택해 주세요.' using errcode = '22023';
  end if;
  v_deadline := ((p_pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul';
  if now() >= v_deadline then raise exception '주문 마감이 지났어요. 다음 픽업 날짜를 선택해 주세요.' using errcode = '22023'; end if;
  if p_refund_preference is null or length(trim(coalesce(p_refund_bank, ''))) = 0
    or length(trim(coalesce(p_refund_account, ''))) < 5
    or length(trim(coalesce(p_refund_account_holder, ''))) = 0
    or length(trim(coalesce(p_depositor_name, ''))) = 0 then
    raise exception '환불 계좌와 입금자 정보를 모두 입력해 주세요.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception '주문 상품을 확인해 주세요.' using errcode = '22023';
  end if;
  if p_linked_profile_id is not null then
    select id into v_linked_profile_id from public.profiles
    where id = p_linked_profile_id and role = 'customer' and id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid;
    if not found then raise exception '연결할 고객 계정을 확인해 주세요.' using errcode = '22023'; end if;
  end if;
  select * into v_payment from public.payment_settings where singleton = true;
  if not found or length(trim(coalesce(v_payment.account_number, ''))) = 0 then
    raise exception '입금 계좌 설정이 완료되지 않아 주문을 접수할 수 없어요.' using errcode = '22023';
  end if;

  insert into public.assisted_customers(phone_number, normalized_phone, linked_profile_id, acquisition_channel, last_order_at)
  values (trim(p_customer_phone), v_phone, v_linked_profile_id, v_channel, now())
  on conflict (normalized_phone) do update set
    phone_number = excluded.phone_number,
    linked_profile_id = coalesce(public.assisted_customers.linked_profile_id, excluded.linked_profile_id),
    acquisition_channel = coalesce(public.assisted_customers.acquisition_channel, excluded.acquisition_channel),
    last_order_at = now()
  where public.assisted_customers.linked_profile_id is null
     or excluded.linked_profile_id is null
     or public.assisted_customers.linked_profile_id = excluded.linked_profile_id
  returning id into v_customer_id;
  if v_customer_id is null then
    raise exception '이 전화번호는 다른 맵소사 계정과 이미 연결되어 있어요.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception '상품 수량을 확인해 주세요.' using errcode = '22023';
    end;
    if v_quantity < 1 or v_quantity > 100 then raise exception '상품 수량을 확인해 주세요.' using errcode = '22023'; end if;
    select p.* into v_product from public.products p join public.stores s on s.id = p.store_id
    where p.id = (v_item ->> 'product_id')::uuid and p.active = true and s.active = true
      and not ((extract(dow from p_pickup_date)::smallint) = any(s.closed_weekdays));
    if not found then raise exception '선택한 픽업일에 주문할 수 없는 상품이 있어요.' using errcode = '22023'; end if;
    v_subtotal := v_subtotal + v_product.consumer_price * v_quantity;
  end loop;

  insert into public.orders(user_id, pickup_date, refund_preference, refund_bank, refund_account, refund_account_holder, depositor_name,
    subtotal, total, payment_due_at, payment_bank, payment_account, payment_account_holder, order_source, assisted_customer_id)
  values (v_operator_id, p_pickup_date, p_refund_preference, trim(p_refund_bank), trim(p_refund_account), trim(p_refund_account_holder), trim(p_depositor_name),
    v_subtotal, v_subtotal, v_due_at, v_payment.bank_name, v_payment.account_number, v_payment.account_holder, 'assisted', v_customer_id)
  returning id, orders.order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and active = true;
    insert into public.order_items(order_id, product_id, quantity, unit_price)
    values (v_order_id, v_product.id, v_quantity, v_product.consumer_price);
  end loop;

  return query select v_order_id, v_order_number, v_subtotal, v_due_at;
end;
$$;
revoke all on function public.create_assisted_order(date, text, uuid, text, public.refund_preference, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_assisted_order(date, text, uuid, text, public.refund_preference, text, text, text, text, jsonb) to authenticated;

-- Preserve transactional order records while removing assisted contact details after three years.
create or replace function public.prune_assisted_customers() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_count bigint;
begin
  delete from public.assisted_customers c where c.last_order_at < now() - interval '3 years';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_assisted_customers() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'mapsosa-prune-assisted-customers';
    perform cron.schedule('mapsosa-prune-assisted-customers', '20 3 * * *', 'select public.prune_assisted_customers()');
  end if;
exception when insufficient_privilege or undefined_table then null;
end $$;

-- Weekly core metrics treat a linked assisted buyer and registered buyer as one person.
drop function if exists public.operator_weekly_growth_metrics(integer);
create function public.operator_weekly_growth_metrics(p_weeks integer default 16)
returns table (
  week_start date, is_current_week boolean, paid_customers bigint, new_customers bigint,
  repeat_customers bigint, gross_gmv bigint, refund_amount bigint, net_gmv bigint,
  active_start bigint, active_end bigint, churned_customers bigint, churn_rate numeric,
  referral_customers bigint, organic_customers bigint, paid_acquisition_customers bigint,
  store_detail_events bigint, add_to_cart_events bigint, checkout_started_events bigint,
  marketing_spend bigint, history_weeks integer, direct_paid_customers bigint,
  assisted_paid_customers bigint, unidentified_assisted_orders bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_operator() then raise exception 'operator access required'; end if;
  return query
  with params as (
    select date_trunc('week', now() at time zone 'Asia/Seoul')::date current_week,
      greatest(1, least(coalesce(p_weeks,16),104)) weeks
  ), weeks as (
    select g::date wk, p.current_week,
      ((g::date)::timestamp at time zone 'Asia/Seoul') starts_at,
      (((g::date + 7)::timestamp) at time zone 'Asia/Seoul') ends_at
    from params p cross join lateral generate_series(p.current_week - ((p.weeks - 1) * 7), p.current_week, interval '7 days') g
  ), paid as (
    select o.id, o.user_id, o.assisted_customer_id, o.order_source, o.total, o.paid_at, o.status,
      case when o.order_source = 'assisted' then coalesce(c.linked_profile_id, c.id) else o.user_id end::text buyer_key,
      case when o.order_source = 'assisted' then 'assisted' else 'direct' end buyer_path,
      coalesce(c.acquisition_channel, s.channel) acquisition_channel,
      date_trunc('week', o.paid_at at time zone 'Asia/Seoul')::date paid_week
    from public.orders o
    join public.profiles account on account.id = o.user_id
    left join public.assisted_customers c on c.id = o.assisted_customer_id
    left join public.acquisition_surveys s on s.user_id = o.user_id and s.response_status = 'answered'
    where o.paid_at is not null and o.status <> 'cancelled_unpaid'
      and ((o.order_source = 'assisted' and c.id is not null)
        or (o.order_source = 'direct' and account.role = 'customer' and account.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid))
  ), first_paid as (
    select buyer_key, min(paid_at) first_paid_at from paid group by buyer_key
  ), first_channel as (
    select distinct on (buyer_key) buyer_key, acquisition_channel
    from paid order by buyer_key, paid_at, id
  ), financial_orders as (
    select o.id, o.total, date_trunc('week', o.paid_at at time zone 'Asia/Seoul')::date paid_week
    from public.orders o join public.profiles account on account.id = o.user_id
    where o.paid_at is not null and o.status <> 'cancelled_unpaid'
      and ((o.order_source in ('direct','assisted') and account.role in ('customer','operator')) or o.order_source = 'legacy_operator')
  ), refunds as (select r.order_id, sum(r.amount)::bigint amount from public.refunds r group by r.order_id),
  order_week as (
    select p.paid_week wk, count(distinct p.buyer_key) customers,
      count(distinct p.buyer_key) filter (where f.first_paid_at >= w.starts_at and f.first_paid_at < w.ends_at) new_count,
      count(distinct p.buyer_key) filter (where f.first_paid_at < w.starts_at) repeat_count,
      count(distinct p.buyer_key) filter (where p.buyer_path='direct') direct_count,
      count(distinct p.buyer_key) filter (where p.buyer_path='assisted') assisted_count
    from paid p join first_paid f using (buyer_key) join weeks w on w.wk=p.paid_week group by p.paid_week
  ), weekly_financials as (
    select p.paid_week wk, sum(p.total)::bigint gross, sum(coalesce(r.amount,0))::bigint refund
    from financial_orders p join weeks w on w.wk=p.paid_week left join refunds r on r.order_id=p.id group by p.paid_week
  ), weekly_acquisition as (
    select w.wk,
      count(distinct f.buyer_key) filter (where c.acquisition_channel='friend_referral')::bigint referral,
      count(distinct f.buyer_key) filter (where c.acquisition_channel in ('kakao_group','search','social_community','store_offline'))::bigint organic,
      count(distinct f.buyer_key) filter (where c.acquisition_channel='paid_ad')::bigint paid_source
    from weeks w left join first_paid f on f.first_paid_at >= w.starts_at and f.first_paid_at < w.ends_at
      left join first_channel c using (buyer_key) group by w.wk
  ), weekly_events as (
    select w.wk,
      count(*) filter (where e.event_name='store_detail_opened' and customer.id is not null)::bigint store_opens,
      count(*) filter (where e.event_name='add_to_cart' and customer.id is not null)::bigint cart_adds,
      count(*) filter (where e.event_name='checkout_started' and customer.id is not null)::bigint checkouts
    from weeks w left join public.analytics_events e on e.created_at >= w.starts_at and e.created_at < w.ends_at
      left join public.profiles customer on customer.id=e.user_id and customer.role='customer' and customer.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
    group by w.wk
  ), weekly_spend as (select m.week_start wk, sum(m.amount)::bigint amount from public.marketing_spend m group by m.week_start),
  active as (
    select w.wk,
      (select count(distinct p.buyer_key) from paid p where p.status not in ('late_payment_refund','refunded') and p.paid_at >= w.starts_at - interval '28 days' and p.paid_at < w.starts_at) a_start,
      (select count(distinct p.buyer_key) from paid p where p.status not in ('late_payment_refund','refunded') and p.paid_at >= w.ends_at - interval '28 days' and p.paid_at < w.ends_at) a_end,
      (select count(distinct old.buyer_key) from paid old where old.status not in ('late_payment_refund','refunded') and old.paid_at >= w.starts_at - interval '28 days' and old.paid_at < w.starts_at
        and not exists (select 1 from paid recent where recent.buyer_key=old.buyer_key and recent.status not in ('late_payment_refund','refunded') and recent.paid_at >= w.ends_at - interval '28 days' and recent.paid_at < w.ends_at)) churned
    from weeks w
  ), history as (
    select case when min(p.paid_week) is null then 0 else greatest(0, ((select current_week from params)-min(p.paid_week))/7+1) end::integer n from paid p
  ), unidentified as (
    select w.wk, count(*)::bigint amount from weeks w join financial_orders f on f.paid_week=w.wk
      join public.orders o on o.id=f.id where o.order_source='legacy_operator'
        or (o.order_source='assisted' and o.assisted_customer_id is null) group by w.wk
  )
  select w.wk, w.wk=w.current_week, coalesce(o.customers,0), coalesce(o.new_count,0), coalesce(o.repeat_count,0),
    coalesce(fin.gross,0), coalesce(fin.refund,0), coalesce(fin.gross,0)-coalesce(fin.refund,0),
    a.a_start, a.a_end, a.churned, case when a.a_start=0 then null else a.churned::numeric/a.a_start end,
    coalesce(ac.referral,0), coalesce(ac.organic,0), coalesce(ac.paid_source,0), coalesce(e.store_opens,0), coalesce(e.cart_adds,0), coalesce(e.checkouts,0),
    coalesce(ms.amount,0), h.n, coalesce(o.direct_count,0), coalesce(o.assisted_count,0), coalesce(u.amount,0)
  from weeks w left join order_week o on o.wk=w.wk left join weekly_financials fin on fin.wk=w.wk
    left join active a on a.wk=w.wk left join weekly_acquisition ac on ac.wk=w.wk left join weekly_events e on e.wk=w.wk
    left join weekly_spend ms on ms.wk=w.wk left join unidentified u on u.wk=w.wk cross join history h order by w.wk;
end;
$$;
revoke all on function public.operator_weekly_growth_metrics(integer) from public, anon;
grant execute on function public.operator_weekly_growth_metrics(integer) to authenticated;

drop function if exists public.operator_retention_cohorts(integer);
create function public.operator_retention_cohorts(p_cohorts integer default 8)
returns table (cohort_week date, cohort_size bigint, week_number integer, retained_customers bigint, retention_rate numeric, acquisition_path text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_operator() then raise exception 'operator access required'; end if;
  return query
  with params as (select date_trunc('week', now() at time zone 'Asia/Seoul')::date current_week, greatest(1,least(coalesce(p_cohorts,8),26)) cohorts),
  paid as (
    select case when o.order_source='assisted' then coalesce(c.linked_profile_id,c.id)::text else o.user_id::text end buyer_key,
      date_trunc('week',o.paid_at at time zone 'Asia/Seoul')::date wk, o.paid_at, o.id,
      case when o.order_source='assisted' then 'assisted' else 'direct' end buyer_path
    from public.orders o join public.profiles account on account.id=o.user_id
      left join public.assisted_customers c on c.id=o.assisted_customer_id
    where o.paid_at is not null and o.status not in ('late_payment_refund','refunded','cancelled_unpaid')
      and ((o.order_source='assisted' and c.id is not null) or (o.order_source='direct' and account.role='customer' and account.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid))
  ), first_paid as (
    select distinct on (buyer_key) buyer_key,wk first_week,buyer_path first_path from paid order by buyer_key,paid_at,id
  ), cohort_weeks as (select (p.current_week-g.n*7)::date cohort_week from params p cross join lateral generate_series(0,p.cohorts-1) g(n)),
  sizes as (select f.first_week,f.first_path,count(*)::bigint cohort_size from first_paid f group by f.first_week,f.first_path),
  matrix as (select c.cohort_week,n::integer week_number,p.first_path from cohort_weeks c cross join lateral generate_series(0,8) n cross join (values ('direct'::text),('assisted'::text)) p(first_path)),
  retained as (select m.cohort_week,m.week_number,m.first_path,count(distinct p.buyer_key)::bigint retained
    from matrix m left join first_paid f on f.first_week=m.cohort_week and f.first_path=m.first_path
      left join paid p on p.buyer_key=f.buyer_key and p.wk=m.cohort_week+m.week_number*7
    group by m.cohort_week,m.week_number,m.first_path)
  select r.cohort_week,coalesce(s.cohort_size,0),r.week_number,r.retained,
    case when coalesce(s.cohort_size,0)=0 then 0 else r.retained::numeric/s.cohort_size end,r.first_path
  from retained r left join sizes s on s.first_week=r.cohort_week and s.first_path=r.first_path cross join params p
  where r.week_number=0 or r.cohort_week+r.week_number*7<=p.current_week order by r.cohort_week desc,r.first_path,r.week_number;
end;
$$;
revoke all on function public.operator_retention_cohorts(integer) from public, anon;
grant execute on function public.operator_retention_cohorts(integer) to authenticated;
