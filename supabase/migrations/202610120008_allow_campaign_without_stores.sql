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
  if coalesce(jsonb_typeof(p_stores), 'null') <> 'array' then
    raise exception '참여 가게 정보를 확인해 주세요.' using errcode = '22023';
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
