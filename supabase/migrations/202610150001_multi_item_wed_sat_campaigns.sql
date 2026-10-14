-- A pickup date can hold several shared campaign items and may be Wednesday or Saturday.
alter table public.weekly_campaigns drop constraint if exists weekly_campaigns_pickup_date_key;
alter table public.weekly_campaigns drop constraint if exists weekly_campaign_saturday;
create index if not exists weekly_campaigns_pickup_date_idx on public.weekly_campaigns(pickup_date);

create or replace function public.save_weekly_campaign_products(p_pickup_date date, p_products jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id uuid := (select auth.uid());
  v_weekday smallint;
  v_product_entry jsonb;
  v_store_entry jsonb;
  v_tier jsonb;
  v_campaign_id uuid;
  v_campaign_store_id uuid;
  v_store_id uuid;
  v_product_id uuid;
  v_store public.stores%rowtype;
  v_previous_price integer;
  v_minimum integer;
  v_price integer;
  v_saved integer := 0;
  v_kept_campaign_ids uuid[] := '{}'::uuid[];
begin
  if not public.is_operator() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  if p_pickup_date is null or extract(isodow from p_pickup_date) not in (3, 6) or p_pickup_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 이후 수요일 또는 토요일을 선택해 주세요.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_products), 'null') <> 'array' or jsonb_array_length(p_products) > 30 then
    raise exception '품목 목록을 확인해 주세요.' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_products) e where jsonb_typeof(e.value) <> 'object') then
    raise exception '품목 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_products) e where nullif(trim(coalesce(e.value ->> 'name', '')), '') is null or nullif(trim(coalesce(e.value ->> 'specification', '')), '') is null) then
    raise exception '각 품목의 이름과 규격을 입력해 주세요.' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_products) e where nullif(e.value ->> 'campaign_id', '') is not null group by e.value ->> 'campaign_id' having count(*) > 1) then
    raise exception '같은 품목이 중복으로 전달됐습니다.' using errcode = '22023';
  end if;

  v_weekday := extract(isodow from p_pickup_date)::smallint;
  perform pg_advisory_xact_lock(hashtextextended('mapsosa-weekly-' || p_pickup_date::text, 0));

  if exists (
    select 1 from public.weekly_campaigns c
    where c.pickup_date = p_pickup_date
      and not exists (select 1 from jsonb_array_elements(p_products) e where e.value ->> 'campaign_id' = c.id::text)
      and exists (
        select 1 from public.weekly_campaign_stores cs
        join public.order_items oi on oi.product_id = cs.product_id
        join public.orders o on o.id = oi.order_id and o.pickup_date = p_pickup_date
        where cs.campaign_id = c.id
      )
  ) then raise exception '주문이 접수된 품목은 삭제할 수 없습니다.' using errcode = '22023'; end if;

  for v_product_entry in select value from jsonb_array_elements(p_products) loop
    if nullif(v_product_entry ->> 'campaign_id', '') is null then
      insert into public.weekly_campaigns(pickup_date, name, specification, description, image_url)
      values (p_pickup_date, trim(v_product_entry ->> 'name'), trim(v_product_entry ->> 'specification'), coalesce(trim(v_product_entry ->> 'description'), ''), nullif(trim(coalesce(v_product_entry ->> 'image_url', '')), ''))
      returning id into v_campaign_id;
    else
      v_campaign_id := (v_product_entry ->> 'campaign_id')::uuid;
      perform 1 from public.weekly_campaigns where id = v_campaign_id and pickup_date = p_pickup_date for update;
      if not found then raise exception '수정할 품목을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.' using errcode = '22023'; end if;
      update public.weekly_campaigns set name = trim(v_product_entry ->> 'name'), specification = trim(v_product_entry ->> 'specification'),
        description = coalesce(trim(v_product_entry ->> 'description'), ''), image_url = nullif(trim(coalesce(v_product_entry ->> 'image_url', '')), ''), active = true, updated_at = now()
      where id = v_campaign_id;
    end if;
    v_kept_campaign_ids := array_append(v_kept_campaign_ids, v_campaign_id);

    if coalesce(jsonb_typeof(v_product_entry -> 'stores'), 'null') <> 'array' then raise exception '품목별 참여 가게 목록을 확인해 주세요.' using errcode = '22023'; end if;
    if exists(select 1 from jsonb_array_elements(v_product_entry -> 'stores') e group by e.value ->> 'store_id' having count(*) > 1) then
      raise exception '품목마다 같은 가게를 중복 선택할 수 없습니다.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.weekly_campaign_stores cs
      where cs.campaign_id = v_campaign_id
        and not exists(select 1 from jsonb_array_elements(v_product_entry -> 'stores') e where (e.value ->> 'store_id')::uuid = cs.store_id)
        and exists(select 1 from public.order_items oi join public.orders o on o.id = oi.order_id where oi.product_id = cs.product_id and o.pickup_date = p_pickup_date)
    ) then raise exception '주문이 접수된 가게는 해당 품목에서 제외할 수 없습니다.' using errcode = '22023'; end if;

    update public.products p set active = false
    from public.weekly_campaign_stores cs
    where cs.campaign_id = v_campaign_id and cs.product_id = p.id
      and not exists(select 1 from jsonb_array_elements(v_product_entry -> 'stores') e where (e.value ->> 'store_id')::uuid = cs.store_id);
    delete from public.weekly_campaign_stores cs
    where cs.campaign_id = v_campaign_id
      and not exists(select 1 from jsonb_array_elements(v_product_entry -> 'stores') e where (e.value ->> 'store_id')::uuid = cs.store_id);

    for v_store_entry in select value from jsonb_array_elements(v_product_entry -> 'stores') loop
      v_store_id := (v_store_entry ->> 'store_id')::uuid;
      select * into v_store from public.stores where id = v_store_id and active and not (v_weekday = any(closed_weekdays)) for update;
      if not found then raise exception '해당 픽업일에 참여할 가게를 확인해 주세요.' using errcode = '22023'; end if;
      if coalesce(jsonb_typeof(v_store_entry -> 'tiers'), 'null') <> 'array' or jsonb_array_length(v_store_entry -> 'tiers') = 0 then
        raise exception '가게별 가격 구간을 하나 이상 입력해 주세요.' using errcode = '22023';
      end if;

      select cs.id, cs.product_id into v_campaign_store_id, v_product_id
      from public.weekly_campaign_stores cs where cs.campaign_id = v_campaign_id and cs.store_id = v_store_id;
      if v_campaign_store_id is null then
        insert into public.products(store_id, name, specification, supply_price, consumer_price, type, slot_size, description, image_url, active)
        values(v_store_id, trim(v_product_entry ->> 'name'), trim(v_product_entry ->> 'specification'), 0, 0, 'instant', null,
          coalesce(trim(v_product_entry ->> 'description'), ''), nullif(trim(coalesce(v_product_entry ->> 'image_url', '')), ''), true)
        returning id into v_product_id;
        insert into public.weekly_campaign_stores(campaign_id, store_id, product_id)
        values(v_campaign_id, v_store_id, v_product_id) returning id into v_campaign_store_id;
      else
        update public.products set name = trim(v_product_entry ->> 'name'), specification = trim(v_product_entry ->> 'specification'),
          description = coalesce(trim(v_product_entry ->> 'description'), ''), image_url = nullif(trim(coalesce(v_product_entry ->> 'image_url', '')), ''), active = true, type = 'instant', slot_size = null
        where id = v_product_id;
      end if;

      delete from public.weekly_price_tiers where campaign_store_id = v_campaign_store_id;
      v_previous_price := null;
      for v_tier in select value from jsonb_array_elements(v_store_entry -> 'tiers') order by (value ->> 'minimum_slots')::integer loop
        v_minimum := (v_tier ->> 'minimum_slots')::integer;
        v_price := (v_tier ->> 'unit_price')::integer;
        if v_minimum < 1 or v_price < 0 or (v_previous_price is not null and v_price > v_previous_price) then
          raise exception '가격 구간은 슬롯 수가 오름차순이고 단가는 같거나 낮아야 합니다.' using errcode = '22023';
        end if;
        insert into public.weekly_price_tiers(campaign_store_id, minimum_slots, unit_price) values(v_campaign_store_id, v_minimum, v_price);
        v_previous_price := v_price;
      end loop;
      if not exists(select 1 from public.weekly_price_tiers where campaign_store_id = v_campaign_store_id and minimum_slots = 1) then
        raise exception '첫 가격 구간은 1슬롯부터 시작해야 합니다.' using errcode = '22023';
      end if;
    end loop;
    v_saved := v_saved + 1;
  end loop;

  for v_campaign_id in select c.id from public.weekly_campaigns c where c.pickup_date = p_pickup_date and not (c.id = any(v_kept_campaign_ids)) loop
    update public.products p set active = false from public.weekly_campaign_stores cs where cs.campaign_id = v_campaign_id and cs.product_id = p.id;
    delete from public.weekly_campaigns where id = v_campaign_id;
  end loop;
  return jsonb_build_object('pickup_date', p_pickup_date, 'saved_products', v_saved);
end;
$$;

revoke all on function public.save_weekly_campaign_products(date, jsonb) from public, anon;
grant execute on function public.save_weekly_campaign_products(date, jsonb) to authenticated;
drop function if exists public.save_weekly_campaign(date, text, text, text, text, jsonb);

-- Keep the existing order and pricing logic while allowing the two supported pickup weekdays.
do $$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.create_order(date,public.refund_preference,text,text,text,text,jsonb)',
    'public.create_assisted_order(date,text,uuid,text,public.refund_preference,text,text,text,text,jsonb)',
    'public.weekly_product_unit_price(uuid,date,integer)',
    'public.weekly_campaign_catalog(date)',
    'public.finalize_weekly_campaign_orders(date,jsonb)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    v_definition := replace(v_definition, 'extract(isodow from p_pickup_date) <> 6', 'extract(isodow from p_pickup_date) not in (3, 6)');
    v_definition := replace(v_definition, 'extract(isodow from p_pickup_date)<>6', 'extract(isodow from p_pickup_date) not in (3, 6)');
    v_definition := replace(v_definition, 'not (6::smallint=any(s.closed_weekdays))', 'not (extract(isodow from p_pickup_date)::smallint=any(s.closed_weekdays))');
    v_definition := replace(v_definition, 'not (6::smallint = any(s.closed_weekdays))', 'not (extract(isodow from p_pickup_date)::smallint = any(s.closed_weekdays))');
    v_definition := replace(v_definition, '토요일 픽업 날짜를 선택해 주세요.', '수요일 또는 토요일 픽업 날짜를 선택해 주세요.');
    v_definition := replace(v_definition, '토요일 픽업일만 확정할 수 있습니다.', '수요일 또는 토요일 픽업일만 확정할 수 있습니다.');
    v_definition := replace(v_definition, '주문 마감이 지났어요. 다음 토요일을 선택해 주세요.', '주문 마감이 지났어요. 다음 픽업일을 선택해 주세요.');
    v_definition := replace(v_definition, '해당 토요일에 주문할 수 없는 품목이 있습니다.', '해당 픽업일에 주문할 수 없는 품목이 있습니다.');
    v_definition := replace(v_definition, '해당 토요일에 판매 중인 품목이 아닙니다.', '해당 픽업일에 판매 중인 품목이 아닙니다.');
    if v_definition like '%extract(isodow from p_pickup_date) <> 6%'
      or v_definition like '%extract(isodow from p_pickup_date)<>6%'
      or v_definition like '%6::smallint%closed_weekdays%' then
      raise exception '수요일·토요일 픽업 검증 변경에 실패했습니다: %', v_signature;
    end if;
    execute v_definition;
  end loop;
end;
$$;
