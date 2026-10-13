create table public.store_ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, store_id)
);

create index store_ratings_store_idx on public.store_ratings(store_id);
alter table public.store_ratings enable row level security;

create policy "users read own store ratings and operators read all"
  on public.store_ratings for select to authenticated
  using (user_id = (select auth.uid()) or public.is_operator());

revoke all on public.store_ratings from anon, authenticated;
grant select on public.store_ratings to authenticated;

create or replace function public.save_store_rating(p_order_id uuid, p_store_id uuid, p_stars smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_order_source text;
  v_status public.order_status;
  v_user_role public.user_role;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception '별점은 1점부터 5점까지 선택해 주세요.' using errcode = '22023';
  end if;
  select p.role into v_user_role from public.profiles p where p.id = v_user_id;
  if v_user_role is distinct from 'customer'::public.user_role then
    raise exception '고객 계정만 별점을 남길 수 있습니다.' using errcode = '42501';
  end if;

  select o.order_source, o.status into v_order_source, v_status
  from public.orders o
  where o.id = p_order_id and o.user_id = v_user_id;

  if not found then
    raise exception '본인 주문을 찾을 수 없습니다.' using errcode = '42501';
  end if;
  if v_order_source is distinct from 'direct' then
    raise exception '직접 주문만 별점을 남길 수 있습니다.' using errcode = '42501';
  end if;
  if v_status not in ('picked_up', 'auto_completed') then
    raise exception '픽업 완료된 주문만 별점을 남길 수 있습니다.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.store_id = p_store_id
  ) then
    raise exception '주문에 포함된 가게만 평가할 수 있습니다.' using errcode = '22023';
  end if;

  insert into public.store_ratings(order_id, store_id, user_id, stars)
  values (p_order_id, p_store_id, v_user_id, p_stars)
  on conflict (order_id, store_id) do update
    set stars = excluded.stars, updated_at = now();
end;
$$;

revoke all on function public.save_store_rating(uuid, uuid, smallint) from public, anon;
grant execute on function public.save_store_rating(uuid, uuid, smallint) to authenticated;

create or replace function public.store_rating_summaries(p_store_ids uuid[])
returns table(store_id uuid, average_rating numeric, rating_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.store_id, round(avg(r.stars)::numeric, 1), count(*)::bigint
  from public.store_ratings r
  join public.stores s on s.id = r.store_id
  where s.active and (p_store_ids is null or r.store_id = any(p_store_ids))
  group by r.store_id;
$$;

revoke all on function public.store_rating_summaries(uuid[]) from public;
grant execute on function public.store_rating_summaries(uuid[]) to anon, authenticated;
