-- Include operator-owned orders in financial and supply reporting, while keeping
-- customer growth, retention, acquisition, and behavior metrics customer-only.

create or replace function public.operator_weekly_growth_metrics(p_weeks integer default 16)
returns table (
  week_start date, is_current_week boolean, paid_customers bigint, new_customers bigint,
  repeat_customers bigint, gross_gmv bigint, refund_amount bigint, net_gmv bigint,
  active_start bigint, active_end bigint, churned_customers bigint, churn_rate numeric,
  referral_customers bigint, organic_customers bigint, paid_acquisition_customers bigint,
  store_detail_events bigint, add_to_cart_events bigint, checkout_started_events bigint,
  marketing_spend bigint, history_weeks integer
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_operator() then raise exception 'operator access required'; end if;
  return query
  with params as (
    select date_trunc('week', now() at time zone 'Asia/Seoul')::date as current_week,
           greatest(1, least(coalesce(p_weeks, 16), 104)) as weeks
  ), weeks as (
    select g::date as wk, p.current_week,
      ((g::date)::timestamp at time zone 'Asia/Seoul') as starts_at,
      (((g::date + 7)::timestamp) at time zone 'Asia/Seoul') as ends_at
    from params p cross join lateral generate_series(p.current_week - ((p.weeks - 1) * 7), p.current_week, interval '7 days') g
  ), paid as (
    select o.id, o.user_id, o.total, o.paid_at, o.status,
      date_trunc('week', o.paid_at at time zone 'Asia/Seoul')::date as paid_week
    from public.orders o
    join public.profiles customer on customer.id = o.user_id
      and customer.role = 'customer' and customer.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
    where o.paid_at is not null and o.status <> 'cancelled_unpaid'
  ), paid_order_totals as (
    select o.id, o.total, o.paid_at,
      date_trunc('week', o.paid_at at time zone 'Asia/Seoul')::date as paid_week
    from public.orders o
    join public.profiles account on account.id = o.user_id
    where o.paid_at is not null and o.status <> 'cancelled_unpaid'
      and (account.role = 'customer' and account.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
        or account.role = 'operator')
  ), first_paid as (
    select user_id, min(paid_at) as first_paid_at from paid group by user_id
  ), refunds as (
    select r.order_id, sum(r.amount)::bigint amount from public.refunds r group by r.order_id
  ), order_week as (
    select p.paid_week wk, count(distinct p.user_id) customers,
      count(distinct p.user_id) filter (where f.first_paid_at >= w.starts_at and f.first_paid_at < w.ends_at) new_count,
      count(distinct p.user_id) filter (where f.first_paid_at < w.starts_at) repeat_count
    from paid p join first_paid f on f.user_id = p.user_id
      join weeks w on w.wk = p.paid_week
    group by p.paid_week
  ), weekly_financials as (
    select p.paid_week wk, sum(p.total)::bigint gross,
      sum(coalesce(r.amount, 0))::bigint refund
    from paid_order_totals p
      join weeks w on w.wk = p.paid_week
      left join refunds r on r.order_id = p.id
    group by p.paid_week
  ), weekly_acquisition as (
    select w.wk,
      count(distinct f.user_id) filter (where s.channel = 'friend_referral')::bigint referral,
      count(distinct f.user_id) filter (where s.channel in ('kakao_group','search','social_community','store_offline'))::bigint organic,
      count(distinct f.user_id) filter (where s.channel = 'paid_ad')::bigint paid_source
    from weeks w left join first_paid f on f.first_paid_at >= w.starts_at and f.first_paid_at < w.ends_at
      left join public.acquisition_surveys s on s.user_id = f.user_id and s.response_status = 'answered'
    group by w.wk
  ), weekly_events as (
    select w.wk,
      count(*) filter (where e.event_name = 'store_detail_opened' and customer.id is not null)::bigint store_opens,
      count(*) filter (where e.event_name = 'add_to_cart' and customer.id is not null)::bigint cart_adds,
      count(*) filter (where e.event_name = 'checkout_started' and customer.id is not null)::bigint checkouts
    from weeks w left join public.analytics_events e on e.created_at >= w.starts_at and e.created_at < w.ends_at
      left join public.profiles customer on customer.id = e.user_id and customer.role = 'customer'
        and customer.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
    group by w.wk
  ), weekly_spend as (
    select m.week_start wk, sum(m.amount)::bigint amount from public.marketing_spend m group by m.week_start
  ), active as (
    select w.wk,
      (select count(distinct p.user_id) from paid p where p.status not in ('late_payment_refund','refunded') and p.paid_at >= w.starts_at - interval '28 days' and p.paid_at < w.starts_at) as a_start,
      (select count(distinct p.user_id) from paid p where p.status not in ('late_payment_refund','refunded') and p.paid_at >= w.ends_at - interval '28 days' and p.paid_at < w.ends_at) as a_end,
      (select count(distinct old.user_id) from paid old where old.status not in ('late_payment_refund','refunded') and old.paid_at >= w.starts_at - interval '28 days' and old.paid_at < w.starts_at
        and not exists (select 1 from paid recent where recent.user_id=old.user_id and recent.status not in ('late_payment_refund','refunded') and recent.paid_at >= w.ends_at - interval '28 days' and recent.paid_at < w.ends_at)) as churned
    from weeks w
  ), history as (
    select case when min(p.paid_week) is null then 0 else
      greatest(0, ((select current_week from params) - min(p.paid_week)) / 7 + 1) end::integer n from paid p
  )
  select w.wk, w.wk = w.current_week,
    coalesce(o.customers,0), coalesce(o.new_count,0), coalesce(o.repeat_count,0),
    coalesce(fin.gross,0), coalesce(fin.refund,0), coalesce(fin.gross,0)-coalesce(fin.refund,0),
    a.a_start, a.a_end, a.churned,
    case when a.a_start = 0 then null else a.churned::numeric / a.a_start end,
    coalesce(ac.referral,0), coalesce(ac.organic,0), coalesce(ac.paid_source,0),
    coalesce(e.store_opens,0), coalesce(e.cart_adds,0), coalesce(e.checkouts,0), coalesce(ms.amount,0), h.n
  from weeks w left join order_week o on o.wk = w.wk
    left join weekly_financials fin on fin.wk = w.wk
    left join active a on a.wk = w.wk
    left join weekly_acquisition ac on ac.wk = w.wk left join weekly_events e on e.wk = w.wk
    left join weekly_spend ms on ms.wk = w.wk cross join history h order by w.wk;
end;
$$;
revoke all on function public.operator_weekly_growth_metrics(integer) from public, anon;
grant execute on function public.operator_weekly_growth_metrics(integer) to authenticated;

create or replace function public.operator_supply_metrics(p_pickup_count integer default 8)
returns table (pickup_date date, store_name text, product_name text, awaiting_payment_quantity bigint,
  paid_quantity bigint, confirmed_quantity bigint, refund_quantity bigint, paid_order_count bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_operator() then raise exception 'operator access required'; end if;
  return query
  with recent_pickups as (
    select distinct o0.pickup_date from public.orders o0
      join public.profiles account on account.id = o0.user_id
      where o0.pickup_date >= (now() at time zone 'Asia/Seoul')::date - 28
        and (account.role = 'customer' and account.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
          or account.role = 'operator')
      order by o0.pickup_date desc limit greatest(1, least(coalesce(p_pickup_count,8), 32))
  )
  select o.pickup_date, s.name, p.name,
    sum(oi.quantity) filter (where o.paid_at is null and o.status='awaiting_payment')::bigint,
    sum(oi.quantity) filter (where o.paid_at is not null and o.status <> 'cancelled_unpaid')::bigint,
    sum(coalesce(oi.confirmed_quantity,0)) filter (where o.paid_at is not null and o.status <> 'cancelled_unpaid')::bigint,
    sum(coalesce(oi.refund_quantity,0))::bigint,
    count(distinct o.id) filter (where o.paid_at is not null and o.status <> 'cancelled_unpaid')::bigint
  from public.orders o join public.profiles account on account.id=o.user_id
    and (account.role = 'customer' and account.id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
      or account.role = 'operator')
    join public.order_items oi on oi.order_id=o.id join public.products p on p.id=oi.product_id
    join public.stores s on s.id=p.store_id
  where o.pickup_date in (select rp.pickup_date from recent_pickups rp)
  group by o.pickup_date,s.name,p.name order by o.pickup_date desc,s.name,p.name;
end;
$$;
revoke all on function public.operator_supply_metrics(integer) from public, anon;
grant execute on function public.operator_supply_metrics(integer) to authenticated;
