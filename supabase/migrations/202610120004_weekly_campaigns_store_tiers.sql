-- A single shared item is offered on Saturday, with independent store tiers.
create table if not exists public.weekly_campaigns (
  id uuid primary key default gen_random_uuid(),
  pickup_date date not null unique,
  name text not null,
  specification text not null,
  description text not null default '',
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_campaign_saturday check (extract(isodow from pickup_date) = 6)
);

create table if not exists public.weekly_campaign_stores (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.weekly_campaigns(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  product_id uuid not null unique references public.products(id),
  created_at timestamptz not null default now(),
  unique (campaign_id, store_id)
);

create table if not exists public.weekly_price_tiers (
  id uuid primary key default gen_random_uuid(),
  campaign_store_id uuid not null references public.weekly_campaign_stores(id) on delete cascade,
  minimum_slots integer not null check (minimum_slots > 0),
  unit_price integer not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  unique (campaign_store_id, minimum_slots)
);

alter table public.weekly_campaigns enable row level security;
alter table public.weekly_campaign_stores enable row level security;
alter table public.weekly_price_tiers enable row level security;
create policy "active weekly campaigns are public" on public.weekly_campaigns for select to anon, authenticated using (active or public.is_operator());
create policy "operators manage weekly campaigns" on public.weekly_campaigns for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "weekly campaign stores are public" on public.weekly_campaign_stores for select to anon, authenticated using (exists (select 1 from public.weekly_campaigns c where c.id = campaign_id and (c.active or public.is_operator())));
create policy "operators manage weekly campaign stores" on public.weekly_campaign_stores for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "weekly price tiers are public" on public.weekly_price_tiers for select to anon, authenticated using (exists (select 1 from public.weekly_campaign_stores cs join public.weekly_campaigns c on c.id = cs.campaign_id where cs.id = campaign_store_id and (c.active or public.is_operator())));
create policy "operators manage weekly price tiers" on public.weekly_price_tiers for all to authenticated using (public.is_operator()) with check (public.is_operator());
grant select on public.weekly_campaigns, public.weekly_campaign_stores, public.weekly_price_tiers to anon, authenticated;
grant insert, update, delete on public.weekly_campaigns, public.weekly_campaign_stores, public.weekly_price_tiers to authenticated;

alter table public.order_items add column if not exists final_unit_price integer check (final_unit_price >= 0);
create or replace function public.save_weekly_campaign(
  p_pickup_date date, p_name text, p_specification text, p_description text, p_image_url text, p_stores jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_campaign_id uuid;
  v_entry jsonb;
  v_tier jsonb;
  v_store_id uuid;
  v_store public.stores%rowtype;
  v_product_id uuid;
  v_campaign_store_id uuid;
  v_previous_price integer;
  v_price integer;
  v_minimum integer;
begin
  if not public.is_operator() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  if p_pickup_date is null or extract(isodow from p_pickup_date) <> 6 or p_pickup_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 이후 토요일을 선택해 주세요.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(trim(coalesce(p_specification, ''))) = 0 then
    raise exception '품목과 규격을 입력해 주세요.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_stores), 'null') <> 'array' or jsonb_array_length(p_stores) = 0 then
    raise exception '참여 가게와 각 가게의 가격 구간을 입력해 주세요.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mapsosa-weekly-' || p_pickup_date::text, 0));
  insert into public.weekly_campaigns(pickup_date, name, specification, description, image_url)
  values (p_pickup_date, trim(p_name), trim(p_specification), coalesce(trim(p_description), ''), nullif(trim(coalesce(p_image_url, '')), ''))
  on conflict (pickup_date) do update set name = excluded.name, specification = excluded.specification,
    description = excluded.description, image_url = excluded.image_url, active = true, updated_at = now()
  returning id into v_campaign_id;

  if exists (
    select 1 from public.weekly_campaign_stores cs
    where cs.campaign_id = v_campaign_id
      and not exists (select 1 from jsonb_array_elements(p_stores) e where (e.value ->> 'store_id')::uuid = cs.store_id)
      and exists (select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where oi.product_id=cs.product_id and o.pickup_date=p_pickup_date)
  ) then raise exception '주문이 접수된 가게는 참여 목록에서 제거할 수 없습니다.' using errcode = '22023'; end if;

  for v_entry in select value from jsonb_array_elements(p_stores) loop
    v_store_id := (v_entry ->> 'store_id')::uuid;
    select * into v_store from public.stores where id = v_store_id and active and not (6::smallint = any(closed_weekdays)) for update;
    if not found then raise exception '참여할 가게를 확인해 주세요.' using errcode = '22023'; end if;
    if coalesce(jsonb_typeof(v_entry -> 'tiers'), 'null') <> 'array' or jsonb_array_length(v_entry -> 'tiers') = 0 then
      raise exception '가게별 가격 구간을 하나 이상 입력해 주세요.' using errcode = '22023';
    end if;

    select cs.id, cs.product_id into v_campaign_store_id, v_product_id
      from public.weekly_campaign_stores cs where cs.campaign_id = v_campaign_id and cs.store_id = v_store_id;
    if v_campaign_store_id is null then
      insert into public.products(store_id, name, specification, supply_price, consumer_price, type, slot_size, description, image_url, active)
      values (v_store_id, trim(p_name), trim(p_specification), 0, 0, 'instant', null, coalesce(trim(p_description), ''), nullif(trim(coalesce(p_image_url, '')), ''), true)
      returning id into v_product_id;
      insert into public.weekly_campaign_stores(campaign_id, store_id, product_id)
      values (v_campaign_id, v_store_id, v_product_id) returning id into v_campaign_store_id;
    else
      update public.products set name = trim(p_name), specification = trim(p_specification), description = coalesce(trim(p_description), ''),
        image_url = nullif(trim(coalesce(p_image_url, '')), ''), active = true, type = 'instant', slot_size = null
      where id = v_product_id;
    end if;

    delete from public.weekly_price_tiers where campaign_store_id = v_campaign_store_id;
    v_previous_price := null;
    for v_tier in select value from jsonb_array_elements(v_entry -> 'tiers') order by (value ->> 'minimum_slots')::integer loop
      v_minimum := (v_tier ->> 'minimum_slots')::integer;
      v_price := (v_tier ->> 'unit_price')::integer;
      if v_minimum < 1 or v_price < 0 or (v_previous_price is not null and v_price > v_previous_price) then
        raise exception '가격 구간은 슬롯 수가 오름차순이고 단가는 같거나 낮아야 합니다.' using errcode = '22023';
      end if;
      insert into public.weekly_price_tiers(campaign_store_id, minimum_slots, unit_price) values (v_campaign_store_id, v_minimum, v_price);
      v_previous_price := v_price;
    end loop;
    if not exists (select 1 from public.weekly_price_tiers where campaign_store_id = v_campaign_store_id and minimum_slots = 1) then
      raise exception '첫 가격 구간은 1슬롯부터 시작해야 합니다.' using errcode = '22023';
    end if;
  end loop;

  delete from public.weekly_campaign_stores cs
  where cs.campaign_id = v_campaign_id and not exists (
    select 1 from jsonb_array_elements(p_stores) e where (e.value ->> 'store_id')::uuid = cs.store_id
  );
  return v_campaign_id;
end;
$$;
revoke all on function public.save_weekly_campaign(date, text, text, text, text, jsonb) from public, anon;
grant execute on function public.save_weekly_campaign(date, text, text, text, text, jsonb) to authenticated;

create or replace function public.weekly_campaign_catalog(p_pickup_date date)
returns table (
  product_id uuid, store_id uuid, store_name text, store_area text, store_address text, closed_weekdays smallint[],
  name text, specification text, description text, image_url text, applied_quantity bigint,
  tiers jsonb
) language sql stable security definer set search_path = '' as $$
  select p.id, s.id, s.name, s.area, s.address, s.closed_weekdays, c.name, c.specification, c.description, c.image_url,
    coalesce((select sum(greatest(oi.quantity - oi.refund_quantity, 0))::bigint
      from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.product_id = p.id and o.pickup_date = c.pickup_date
        and o.status not in ('cancelled_unpaid','late_payment_refund','refunded')
        and not (o.cancellation_requested_at is not null and o.paid_at is null)), 0),
    (select jsonb_agg(jsonb_build_object('minimum_slots', t.minimum_slots, 'unit_price', t.unit_price) order by t.minimum_slots)
      from public.weekly_price_tiers t where t.campaign_store_id = cs.id)
  from public.weekly_campaigns c
  join public.weekly_campaign_stores cs on cs.campaign_id = c.id
  join public.products p on p.id = cs.product_id
  join public.stores s on s.id = cs.store_id
  where c.pickup_date = p_pickup_date and c.active and s.active and p.active
    and not (6::smallint = any(s.closed_weekdays))
  order by s.name;
$$;
revoke all on function public.weekly_campaign_catalog(date) from public;
grant execute on function public.weekly_campaign_catalog(date) to anon, authenticated;

create or replace function public.weekly_product_unit_price(p_product_id uuid, p_pickup_date date, p_additional_quantity integer default 0)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_campaign_store_id uuid; v_applied bigint; v_price integer;
begin
  select cs.id into v_campaign_store_id from public.weekly_campaign_stores cs
  join public.weekly_campaigns c on c.id = cs.campaign_id
  where cs.product_id = p_product_id and c.pickup_date = p_pickup_date and c.active;
  if not found then raise exception '해당 토요일에 판매 중인 품목이 아닙니다.' using errcode = '22023'; end if;
  select coalesce(sum(greatest(oi.quantity - oi.refund_quantity, 0)), 0) into v_applied
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where oi.product_id = p_product_id and o.pickup_date = p_pickup_date
    and o.status not in ('cancelled_unpaid','late_payment_refund','refunded')
    and not (o.cancellation_requested_at is not null and o.paid_at is null);
  select t.unit_price into v_price from public.weekly_price_tiers t
  where t.campaign_store_id = v_campaign_store_id and t.minimum_slots <= v_applied + greatest(0, p_additional_quantity)
  order by t.minimum_slots desc limit 1;
  if v_price is null then raise exception '가게의 가격 구간이 등록되지 않았습니다.' using errcode = '22023'; end if;
  return v_price;
end;
$$;
revoke all on function public.weekly_product_unit_price(uuid, date, integer) from public;
grant execute on function public.weekly_product_unit_price(uuid, date, integer) to authenticated;

-- Keep order creation authoritative: price each reservation at its current store tier.
create or replace function public.create_order(
  p_pickup_date date, p_refund_preference public.refund_preference, p_refund_bank text,
  p_refund_account text, p_refund_account_holder text, p_depositor_name text, p_items jsonb
) returns table (order_id uuid, order_number text, total integer, payment_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_item jsonb; v_product public.products%rowtype; v_quantity integer;
  v_subtotal integer := 0; v_order_id uuid; v_order_number text; v_due_at timestamptz := now();
  v_deadline timestamptz; v_payment public.payment_settings%rowtype; v_price integer;
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_pickup_date is null or p_pickup_date < (now() at time zone 'Asia/Seoul')::date or extract(isodow from p_pickup_date) <> 6 then
    raise exception '토요일 픽업 날짜를 선택해 주세요.' using errcode = '22023';
  end if;
  v_deadline := ((p_pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul';
  if now() >= v_deadline then raise exception '주문 마감이 지났어요. 다음 토요일을 선택해 주세요.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_refund_bank,''))) = 0 or length(trim(coalesce(p_refund_account,''))) < 5 or length(trim(coalesce(p_refund_account_holder,''))) = 0 or length(trim(coalesce(p_depositor_name,''))) = 0 then
    raise exception '환불 계좌와 입금자 정보를 입력해 주세요.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception '주문 상품을 확인해 주세요.' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) e group by e.value ->> 'product_id' having count(*) > 1) then raise exception '같은 가게 상품은 한 줄로 수량을 입력해 주세요.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mapsosa-weekly-' || p_pickup_date::text, 0));
  select * into v_payment from public.payment_settings where singleton = true;
  if not found or length(trim(coalesce(v_payment.account_number,''))) = 0 then raise exception '입금 계좌 설정이 완료되지 않아 주문을 접수할 수 없어요.' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 100 then raise exception '상품 수량을 확인해 주세요.' using errcode = '22023'; end if;
    if (select count(*) from public.weekly_campaign_stores cs join public.weekly_campaigns c on c.id=cs.campaign_id
      join public.products p on p.id=cs.product_id join public.stores s on s.id=cs.store_id
      where cs.product_id=(v_item->>'product_id')::uuid and c.pickup_date=p_pickup_date and c.active and p.active and s.active and not (6::smallint=any(s.closed_weekdays))) <> 1 then
      raise exception '해당 토요일에 주문할 수 없는 품목이 있습니다.' using errcode = '22023';
    end if;
    v_price := public.weekly_product_unit_price((v_item->>'product_id')::uuid, p_pickup_date, v_quantity);
    v_subtotal := v_subtotal + v_price * v_quantity;
  end loop;
  insert into public.orders(user_id,pickup_date,refund_preference,refund_bank,refund_account,refund_account_holder,depositor_name,subtotal,total,payment_due_at,payment_bank,payment_account,payment_account_holder)
  values (v_user_id,p_pickup_date,p_refund_preference,trim(p_refund_bank),trim(p_refund_account),trim(p_refund_account_holder),trim(p_depositor_name),v_subtotal,v_subtotal,v_due_at,v_payment.bank_name,v_payment.account_number,v_payment.account_holder)
  returning id,orders.order_number into v_order_id,v_order_number;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select p.* into v_product from public.products p join public.weekly_campaign_stores cs on cs.product_id=p.id join public.weekly_campaigns c on c.id=cs.campaign_id join public.stores s on s.id=cs.store_id
    where p.id=(v_item->>'product_id')::uuid and p.active and c.pickup_date=p_pickup_date and c.active and s.active and not (6::smallint=any(s.closed_weekdays));
    v_price := public.weekly_product_unit_price(v_product.id,p_pickup_date,v_quantity);
    insert into public.order_items(order_id,product_id,quantity,unit_price) values (v_order_id,v_product.id,v_quantity,v_price);
  end loop;
  return query select v_order_id,v_order_number,v_subtotal,v_due_at;
end;
$$;
revoke all on function public.create_order(date, public.refund_preference, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_order(date, public.refund_preference, text, text, text, text, jsonb) to authenticated;

-- Assisted purchases use the same campaign and per-store tier calculation.
create or replace function public.create_assisted_order(
  p_pickup_date date, p_customer_nickname text, p_linked_profile_id uuid, p_acquisition_channel text,
  p_refund_preference public.refund_preference, p_refund_bank text, p_refund_account text,
  p_refund_account_holder text, p_depositor_name text, p_items jsonb
) returns table (order_id uuid, order_number text, total integer, payment_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_operator_id uuid := auth.uid(); v_nickname text := nullif(regexp_replace(trim(coalesce(p_customer_nickname,'')), '\s+', ' ', 'g'), '');
  v_normalized_nickname text; v_customer_id uuid; v_linked_profile_id uuid; v_channel text := nullif(trim(coalesce(p_acquisition_channel,'')), '');
  v_item jsonb; v_product public.products%rowtype; v_quantity integer; v_subtotal integer := 0; v_order_id uuid;
  v_order_number text; v_due_at timestamptz := now(); v_deadline timestamptz; v_payment public.payment_settings%rowtype; v_price integer;
begin
  if v_operator_id is null or not public.is_operator() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  if v_nickname is null or length(v_nickname)>40 then raise exception '구매자의 닉네임을 1~40자로 입력해 주세요.' using errcode = '22023'; end if;
  v_normalized_nickname := lower(v_nickname);
  if v_channel is not null and v_channel not in ('friend_referral','kakao_group','search','social_community','paid_ad','store_offline','other','unknown') then raise exception '유입 경로를 확인해 주세요.' using errcode = '22023'; end if;
  if p_pickup_date is null or p_pickup_date < (now() at time zone 'Asia/Seoul')::date or extract(isodow from p_pickup_date)<>6 then raise exception '토요일 픽업 날짜를 선택해 주세요.' using errcode = '22023'; end if;
  v_deadline := ((p_pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul';
  if now()>=v_deadline then raise exception '주문 마감이 지났어요. 다음 토요일을 선택해 주세요.' using errcode = '22023'; end if;
  if p_refund_preference is null or length(trim(coalesce(p_refund_bank,'')))=0 or length(trim(coalesce(p_refund_account,'')))<5 or length(trim(coalesce(p_refund_account_holder,'')))=0 or length(trim(coalesce(p_depositor_name,'')))=0 then raise exception '환불 계좌와 입금자 정보를 모두 입력해 주세요.' using errcode = '22023'; end if;
  if coalesce(jsonb_typeof(p_items),'null')<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>30 then raise exception '주문 상품을 확인해 주세요.' using errcode = '22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e group by e.value ->> 'product_id' having count(*)>1) then raise exception '같은 가게 상품은 한 줄로 수량을 입력해 주세요.' using errcode = '22023'; end if;
  if p_linked_profile_id is not null then
    select id into v_linked_profile_id from public.profiles where id=p_linked_profile_id and role='customer' and id<>'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid;
    if not found then raise exception '연결할 고객 계정을 확인해 주세요.' using errcode = '22023'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mapsosa-weekly-' || p_pickup_date::text, 0));
  select * into v_payment from public.payment_settings where singleton=true;
  if not found or length(trim(coalesce(v_payment.account_number,'')))=0 then raise exception '입금 계좌 설정이 완료되지 않아 주문을 접수할 수 없어요.' using errcode = '22023'; end if;
  insert into public.assisted_customers(nickname,normalized_nickname,linked_profile_id,acquisition_channel,last_order_at)
  values(v_nickname,v_normalized_nickname,v_linked_profile_id,v_channel,now())
  on conflict(normalized_nickname) do update set nickname=excluded.nickname,linked_profile_id=coalesce(public.assisted_customers.linked_profile_id,excluded.linked_profile_id),acquisition_channel=coalesce(public.assisted_customers.acquisition_channel,excluded.acquisition_channel),last_order_at=now()
  where public.assisted_customers.linked_profile_id is null or excluded.linked_profile_id is null or public.assisted_customers.linked_profile_id=excluded.linked_profile_id returning id into v_customer_id;
  if v_customer_id is null then raise exception '이 닉네임은 다른 계정과 연결되어 있어요. 동명이인은 구분되는 닉네임을 입력해 주세요.' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity<1 or v_quantity>100 then raise exception '상품 수량을 확인해 주세요.' using errcode = '22023'; end if;
    if (select count(*) from public.weekly_campaign_stores cs join public.weekly_campaigns c on c.id=cs.campaign_id
      join public.products p on p.id=cs.product_id join public.stores s on s.id=cs.store_id
      where cs.product_id=(v_item->>'product_id')::uuid and c.pickup_date=p_pickup_date and c.active and p.active and s.active and not (6::smallint=any(s.closed_weekdays)))<>1 then raise exception '해당 토요일에 주문할 수 없는 품목이 있습니다.' using errcode = '22023'; end if;
    v_subtotal := v_subtotal + public.weekly_product_unit_price((v_item->>'product_id')::uuid,p_pickup_date,v_quantity)*v_quantity;
  end loop;
  insert into public.orders(user_id,pickup_date,refund_preference,refund_bank,refund_account,refund_account_holder,depositor_name,subtotal,total,payment_due_at,payment_bank,payment_account,payment_account_holder,order_source,assisted_customer_id)
  values(v_operator_id,p_pickup_date,p_refund_preference,trim(p_refund_bank),trim(p_refund_account),trim(p_refund_account_holder),trim(p_depositor_name),v_subtotal,v_subtotal,v_due_at,v_payment.bank_name,v_payment.account_number,v_payment.account_holder,'assisted',v_customer_id)
  returning id,orders.order_number into v_order_id,v_order_number;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    select p.* into v_product from public.products p join public.weekly_campaign_stores cs on cs.product_id=p.id join public.weekly_campaigns c on c.id=cs.campaign_id join public.stores s on s.id=cs.store_id where p.id=(v_item->>'product_id')::uuid and p.active and c.pickup_date=p_pickup_date and c.active and s.active and not (6::smallint=any(s.closed_weekdays));
    v_price := public.weekly_product_unit_price(v_product.id,p_pickup_date,v_quantity);
    insert into public.order_items(order_id,product_id,quantity,unit_price) values(v_order_id,v_product.id,v_quantity,v_price);
  end loop;
  return query select v_order_id,v_order_number,v_subtotal,v_due_at;
end;
$$;
revoke all on function public.create_assisted_order(date,text,uuid,text,public.refund_preference,text,text,text,text,jsonb) from public, anon;
grant execute on function public.create_assisted_order(date,text,uuid,text,public.refund_preference,text,text,text,text,jsonb) to authenticated;

-- A single transactional finalization adds per-order refunds for any lower final tier.
create or replace function public.finalize_pickup_order_batch(p_pickup_date date, p_orders jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb; v_result record; v_results jsonb := '[]'::jsonb; v_order_id uuid; v_note text; v_reason public.refund_reason;
  v_product record; v_confirmed_for_product integer; v_item_count integer; v_distinct_item_count integer; v_bad_item boolean;
  v_final_price integer; v_line_final_price integer; v_discount integer; v_line record;
begin
  if not public.is_operator() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  if coalesce(jsonb_typeof(p_orders),'null')<>'array' or jsonb_array_length(p_orders)=0 then raise exception '최종 확정할 주문을 확인해 주세요.' using errcode = '22023'; end if;
  for v_entry in select value from jsonb_array_elements(p_orders) loop
    v_order_id := (v_entry->>'order_id')::uuid;
    if coalesce(jsonb_typeof(v_entry->'confirmed_items'),'null')<>'array' then raise exception '주문 상품 수량이 모두 포함되지 않았습니다.' using errcode = '22023'; end if;
    select count(*),count(distinct (item.value->>'order_item_id')::uuid) into v_item_count,v_distinct_item_count from jsonb_array_elements(v_entry->'confirmed_items') item(value);
    if v_item_count<>(select count(*) from public.order_items where order_id=v_order_id) or v_item_count<>v_distinct_item_count then raise exception '주문 상품이 중복되었거나 누락되었습니다.' using errcode = '22023'; end if;
    select exists(select 1 from jsonb_array_elements(v_entry->'confirmed_items') item(value) left join public.order_items oi on oi.id=(item.value->>'order_item_id')::uuid and oi.order_id=v_order_id where oi.id is null or item.value->>'confirmed_quantity' is null or (item.value->>'confirmed_quantity')::integer<0 or (item.value->>'confirmed_quantity')::integer>oi.quantity) into v_bad_item;
    if v_bad_item then raise exception '주문 상품별 확정 수량을 확인해 주세요.' using errcode = '22023'; end if;
  end loop;
  for v_product in
    select distinct oi.product_id, inv.available_quantity from jsonb_array_elements(p_orders) entry(value)
    cross join lateral jsonb_array_elements(entry.value->'confirmed_items') item(value)
    join public.order_items oi on oi.id=(item.value->>'order_item_id')::uuid
    left join public.pickup_product_inventory inv on inv.product_id=oi.product_id and inv.pickup_date=p_pickup_date
  loop
    if v_product.available_quantity is null then raise exception '상품별 가게 물량 초안이 없습니다. 물량을 다시 저장해 주세요.' using errcode = '22023'; end if;
    select coalesce(sum((item.value->>'confirmed_quantity')::integer),0)::integer into v_confirmed_for_product
    from jsonb_array_elements(p_orders) entry(value) cross join lateral jsonb_array_elements(entry.value->'confirmed_items') item(value)
    join public.order_items oi on oi.id=(item.value->>'order_item_id')::uuid where oi.product_id=v_product.product_id;
    if v_confirmed_for_product>v_product.available_quantity then raise exception '주문별 조정 수량이 확보 수량을 넘었습니다.' using errcode = '22023'; end if;
  end loop;
  for v_entry in select value from jsonb_array_elements(p_orders) loop
    v_order_id := (v_entry->>'order_id')::uuid; v_note := left(trim(coalesce(v_entry->>'confirmation_note','')),500);
    v_reason := coalesce(nullif(v_entry->>'refund_reason','')::public.refund_reason,'quantity_unavailable');
    if not exists(select 1 from public.orders o where o.id=v_order_id and o.pickup_date=p_pickup_date and o.inventory_reviewed_at is not null and o.status in ('paid_recruiting','slot_confirmed','store_checking')) then raise exception '1차 검토가 끝나지 않았거나 처리된 주문이 있습니다.' using errcode = '22023'; end if;
    select * into v_result from public.finalize_order_for_pickup(v_order_id,v_entry->'confirmed_items',v_reason,'가게 확인 결과 일부 수량을 준비하기 어려워 해당 금액을 환불합니다.');
    if v_note<>'' then
      update public.pickup_passes pp set item_snapshot=coalesce((select jsonb_agg(item.value||jsonb_build_object('confirmation_note',v_note) order by item.ordinality) from jsonb_array_elements(pp.item_snapshot) with ordinality item(value,ordinality)),'[]'::jsonb) where pp.order_id=v_order_id;
      update public.refunds set message=v_note where order_id=v_order_id and transferred_at is null and message not like '%낮은 가격 구간%';
    end if;
    v_results := v_results||jsonb_build_array(jsonb_build_object('order_id',v_order_id,'final_status',v_result.final_status,'refund_total',v_result.refund_total,'confirmed_total',v_result.confirmed_total));
  end loop;

  for v_product in
    select distinct oi.product_id, cs.id as campaign_store_id
    from jsonb_array_elements(p_orders) entry(value) cross join lateral jsonb_array_elements(entry.value->'confirmed_items') item(value)
    join public.order_items oi on oi.id=(item.value->>'order_item_id')::uuid
    join public.weekly_campaign_stores cs on cs.product_id=oi.product_id
  loop
    select coalesce(sum(oi.confirmed_quantity),0)::integer into v_confirmed_for_product
    from public.order_items oi join public.orders o on o.id=oi.order_id
    where oi.product_id=v_product.product_id and o.pickup_date=p_pickup_date and oi.confirmed_quantity is not null;
    select t.unit_price into v_final_price from public.weekly_price_tiers t
    where t.campaign_store_id=v_product.campaign_store_id and t.minimum_slots<=v_confirmed_for_product
    order by t.minimum_slots desc limit 1;
    if v_final_price is null then raise exception '최종 가격 구간을 찾지 못했습니다.' using errcode = '22023'; end if;
    for v_entry in select value from jsonb_array_elements(p_orders) loop
      v_order_id := (v_entry->>'order_id')::uuid;
      for v_line in select oi.id, oi.order_id, oi.confirmed_quantity, oi.unit_price from public.order_items oi
        where oi.order_id=v_order_id and oi.product_id=v_product.product_id and coalesce(oi.confirmed_quantity,0)>0 loop
        v_line_final_price := least(v_line.unit_price, v_final_price);
        v_discount := greatest(0,(v_line.unit_price-v_line_final_price)*v_line.confirmed_quantity);
        update public.order_items set final_unit_price=v_line_final_price where id=v_line.id;
        if v_discount>0 then
          insert into public.refunds(order_id,order_item_id,reason,amount,message)
          values(v_line.order_id,v_line.id,'quantity_unavailable',v_discount,'가게 최종 주문량이 낮은 가격 구간에 도달해 차액을 환불합니다.');
        end if;
      end loop;
    end loop;
  end loop;
  return v_results;
end;
$$;
revoke all on function public.finalize_pickup_order_batch(date,jsonb) from public, anon;
grant execute on function public.finalize_pickup_order_batch(date,jsonb) to authenticated;
