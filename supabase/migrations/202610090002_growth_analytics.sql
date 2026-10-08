-- Optional, first-party growth analytics. No anonymous identifiers or event metadata.
alter table public.profiles
  add column if not exists analytics_consent boolean not null default false,
  add column if not exists analytics_consent_updated_at timestamptz;
revoke update on public.profiles from authenticated;
grant update (nickname, analytics_consent, analytics_consent_updated_at) on public.profiles to authenticated;

create table if not exists public.acquisition_surveys (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  response_status text not null check (response_status in ('answered', 'skipped')),
  channel text check (channel in ('friend_referral', 'kakao_group', 'search', 'social_community', 'paid_ad', 'store_offline', 'other', 'unknown')),
  responded_at timestamptz not null default now(),
  constraint acquisition_response_channel check (
    (response_status = 'answered' and channel is not null) or
    (response_status = 'skipped' and channel is null)
  )
);
alter table public.acquisition_surveys enable row level security;
create policy "users read own acquisition survey" on public.acquisition_surveys
  for select to authenticated using (user_id = (select auth.uid()) or public.is_operator());
create policy "users answer acquisition survey once after 48 hours" on public.acquisition_surveys
  for insert to authenticated with check (
    user_id = (select auth.uid()) and
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.created_at <= now() - interval '48 hours')
  );
grant select, insert on public.acquisition_surveys to authenticated;

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_name text not null check (event_name in ('store_detail_opened', 'add_to_cart', 'checkout_started')),
  store_id uuid references public.stores(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_created_at_idx on public.analytics_events(created_at);
create index if not exists analytics_events_user_created_idx on public.analytics_events(user_id, created_at);
alter table public.analytics_events enable row level security;
create policy "operators read analytics events" on public.analytics_events
  for select to authenticated using (public.is_operator());
create policy "consenting users record own analytics events" on public.analytics_events
  for insert to authenticated with check (
    user_id = (select auth.uid()) and
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.analytics_consent)
  );
grant select, insert on public.analytics_events to authenticated;

create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  week_start date not null check (extract(isodow from week_start) = 1),
  campaign text not null check (length(trim(campaign)) between 1 and 100),
  amount integer not null check (amount > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.marketing_spend enable row level security;
create policy "operators manage marketing spend" on public.marketing_spend
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
grant select, insert, update, delete on public.marketing_spend to authenticated;

create or replace function public.prune_analytics_events() returns bigint
language plpgsql security definer set search_path = '' as $$
declare removed bigint;
begin
  delete from public.analytics_events where created_at < now() - interval '12 months';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_analytics_events() from public, anon, authenticated;
do $$
begin
  if to_regclass('cron.job') is not null then
    execute $schedule$
      select cron.schedule('mapsosa-prune-analytics-events', '0 3 * * *',
        'select public.prune_analytics_events()')
      where not exists (select 1 from cron.job where jobname = 'mapsosa-prune-analytics-events')
    $schedule$;
  end if;
end;
$$;

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
    where o.paid_at is not null and o.status <> 'cancelled_unpaid'
  ), first_paid as (
    select user_id, min(paid_at) as first_paid_at from paid group by user_id
  ), refunds as (
    select r.order_id, sum(r.amount)::bigint amount from public.refunds r group by r.order_id
  ), order_week as (
    select p.paid_week wk, count(distinct p.user_id) customers,
      count(distinct p.user_id) filter (where f.first_paid_at >= w.starts_at and f.first_paid_at < w.ends_at) new_count,
      count(distinct p.user_id) filter (where f.first_paid_at < w.starts_at) repeat_count,
      sum(p.total)::bigint gross, sum(coalesce(r.amount, 0))::bigint refund
    from paid p join first_paid f on f.user_id = p.user_id
      join weeks w on w.wk = p.paid_week left join refunds r on r.order_id = p.id
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
      count(*) filter (where e.event_name = 'store_detail_opened')::bigint store_opens,
      count(*) filter (where e.event_name = 'add_to_cart')::bigint cart_adds,
      count(*) filter (where e.event_name = 'checkout_started')::bigint checkouts
    from weeks w left join public.analytics_events e on e.created_at >= w.starts_at and e.created_at < w.ends_at
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
    coalesce(o.gross,0), coalesce(o.refund,0), coalesce(o.gross,0)-coalesce(o.refund,0),
    a.a_start, a.a_end, a.churned,
    case when a.a_start = 0 then null else a.churned::numeric / a.a_start end,
    coalesce(ac.referral,0), coalesce(ac.organic,0), coalesce(ac.paid_source,0),
    coalesce(e.store_opens,0), coalesce(e.cart_adds,0), coalesce(e.checkouts,0), coalesce(ms.amount,0), h.n
  from weeks w left join order_week o on o.wk = w.wk left join active a on a.wk = w.wk
    left join weekly_acquisition ac on ac.wk = w.wk left join weekly_events e on e.wk = w.wk
    left join weekly_spend ms on ms.wk = w.wk cross join history h order by w.wk;
end;
$$;
revoke all on function public.operator_weekly_growth_metrics(integer) from public, anon;
grant execute on function public.operator_weekly_growth_metrics(integer) to authenticated;

create or replace function public.operator_retention_cohorts(p_cohorts integer default 8)
returns table (cohort_week date, cohort_size bigint, week_number integer, retained_customers bigint, retention_rate numeric)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_operator() then raise exception 'operator access required'; end if;
  return query
  with paid as (
    select o.user_id, o.paid_at, date_trunc('week', o.paid_at at time zone 'Asia/Seoul')::date wk
    from public.orders o where o.paid_at is not null and o.status <> 'cancelled_unpaid'
  ), first_paid as (select user_id, min(paid_at) first_at from paid group by user_id),
  cohorts as (
    select f.user_id, date_trunc('week', f.first_at at time zone 'Asia/Seoul')::date cohort_week
    from first_paid f
    where date_trunc('week', f.first_at at time zone 'Asia/Seoul')::date >=
      date_trunc('week', now() at time zone 'Asia/Seoul')::date - ((greatest(1,least(coalesce(p_cohorts,8),24)) - 1) * 7)
  ), cohort_sizes as (select c.cohort_week, count(*)::bigint cohort_size from cohorts c group by c.cohort_week),
  mature_offsets as (
    select s.cohort_week, s.cohort_size, offsets_gen.week_number
    from cohort_sizes s cross join lateral generate_series(
      1, least(8, ((date_trunc('week', now() at time zone 'Asia/Seoul')::date - s.cohort_week) / 7) - 1)
    ) as offsets_gen(week_number)
  ), returns as (
    select m.cohort_week, m.cohort_size, m.week_number, count(distinct p.user_id)::bigint retained
    from mature_offsets m join cohorts c on c.cohort_week=m.cohort_week
      left join paid p on p.user_id=c.user_id and p.wk=m.cohort_week + m.week_number * 7
    group by m.cohort_week, m.cohort_size, m.week_number
  )
  select r.cohort_week, r.cohort_size, r.week_number, r.retained,
    r.retained::numeric / nullif(r.cohort_size,0)
  from returns r order by r.cohort_week desc, r.week_number;
end;
$$;
revoke all on function public.operator_retention_cohorts(integer) from public, anon;
grant execute on function public.operator_retention_cohorts(integer) to authenticated;

create or replace function public.operator_supply_metrics(p_pickup_count integer default 8)
returns table (pickup_date date, store_name text, product_name text, awaiting_payment_quantity bigint,
  paid_quantity bigint, confirmed_quantity bigint, refund_quantity bigint, paid_order_count bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_operator() then raise exception 'operator access required'; end if;
  return query
  with recent_pickups as (
    select distinct pr0.pickup_date from public.pickup_rounds pr0
      where pr0.pickup_date >= (now() at time zone 'Asia/Seoul')::date - 28
      order by pr0.pickup_date desc limit greatest(1, least(coalesce(p_pickup_count,8), 32))
  )
  select pr.pickup_date, s.name, p.name,
    sum(oi.quantity) filter (where o.paid_at is null and o.status='awaiting_payment')::bigint,
    sum(oi.quantity) filter (where o.paid_at is not null and o.status <> 'cancelled_unpaid')::bigint,
    sum(coalesce(oi.confirmed_quantity,0)) filter (where o.paid_at is not null and o.status <> 'cancelled_unpaid')::bigint,
    sum(coalesce(oi.refund_quantity,0))::bigint,
    count(distinct o.id) filter (where o.paid_at is not null and o.status <> 'cancelled_unpaid')::bigint
  from public.orders o join public.pickup_rounds pr on pr.id=o.round_id
    join public.order_items oi on oi.order_id=o.id join public.products p on p.id=oi.product_id
    join public.stores s on s.id=p.store_id
  where pr.pickup_date in (select rp.pickup_date from recent_pickups rp)
  group by pr.pickup_date,s.name,p.name order by pr.pickup_date desc,s.name,p.name;
end;
$$;
revoke all on function public.operator_supply_metrics(integer) from public, anon;
grant execute on function public.operator_supply_metrics(integer) to authenticated;
