alter table public.orders
  add column if not exists inventory_reviewed_at timestamptz;

create table if not exists public.pickup_product_inventory (
  pickup_date date not null,
  product_id uuid not null references public.products(id),
  available_quantity integer not null check (available_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (pickup_date, product_id)
);
alter table public.pickup_product_inventory enable row level security;
drop policy if exists "operators manage pickup product inventory" on public.pickup_product_inventory;
create policy "operators manage pickup product inventory" on public.pickup_product_inventory
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

create or replace function public.prepare_pickup_order_drafts(p_pickup_date date, p_drafts jsonb, p_product_inventory jsonb default '[]'::jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_draft jsonb;
  v_item jsonb;
  v_order_id uuid;
  v_quantity integer;
  v_item_id uuid;
  v_seen_items uuid[];
  v_reason public.refund_reason;
  v_expected integer;
begin
  if not public.is_operator() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_drafts), 'null') <> 'array' or jsonb_array_length(p_drafts) = 0 then
    raise exception '검토할 주문을 확인해주세요.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_product_inventory), 'null') <> 'array' then
    raise exception '상품별 가용 수량을 확인해주세요.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_product_inventory) loop
    insert into public.pickup_product_inventory (pickup_date, product_id, available_quantity, updated_at)
    values (p_pickup_date, (v_item ->> 'product_id')::uuid, greatest(0, (v_item ->> 'available_quantity')::integer), now())
    on conflict (pickup_date, product_id) do update
      set available_quantity = excluded.available_quantity, updated_at = excluded.updated_at;
  end loop;

  for v_draft in select value from jsonb_array_elements(p_drafts) loop
    v_order_id := (v_draft ->> 'order_id')::uuid;
    v_reason := coalesce(nullif(v_draft ->> 'refund_reason', '')::public.refund_reason, 'quantity_unavailable');
    if not exists (
      select 1 from public.orders o
      where o.id = v_order_id and o.pickup_date = p_pickup_date and o.paid_at is not null
        and o.status in ('paid_recruiting', 'slot_confirmed', 'store_checking')
    ) then
      raise exception '물량 검토 단계의 주문이 아니거나 선택한 픽업일이 다릅니다.' using errcode = '22023';
    end if;
    select count(*) into v_expected from public.order_items where order_id = v_order_id;
    if coalesce(jsonb_typeof(v_draft -> 'items'), 'null') <> 'array' or jsonb_array_length(v_draft -> 'items') <> v_expected then
      raise exception '주문 상품이 모두 포함되어 있지 않습니다.' using errcode = '22023';
    end if;
    v_seen_items := array[]::uuid[];
    for v_item in select value from jsonb_array_elements(v_draft -> 'items') loop
      v_item_id := (v_item ->> 'order_item_id')::uuid;
      if v_item_id = any(v_seen_items) then raise exception '같은 상품이 중복 포함되어 있습니다.' using errcode = '22023'; end if;
      v_seen_items := array_append(v_seen_items, v_item_id);
      v_quantity := (v_item ->> 'proposed_quantity')::integer;
      if v_quantity < 0 then raise exception '확정 가능 수량을 확인해주세요.' using errcode = '22023'; end if;
      update public.order_items
      set proposed_quantity = v_quantity,
          refund_reason = case when v_quantity < quantity then v_reason else null end
      where id = v_item_id and order_id = v_order_id and v_quantity <= quantity;
      if not found then raise exception '주문 상품 수량이 변경됐거나 잘못된 값입니다.' using errcode = '22023'; end if;
    end loop;
    update public.orders o
    set inventory_reviewed_at = now(),
        status = case when o.status = 'paid_recruiting' and exists (
          select 1 from public.order_items oi join public.products p on p.id = oi.product_id
          where oi.order_id = o.id and p.type = 'slot'
        ) then 'slot_confirmed'::public.order_status
        when o.status = 'paid_recruiting' then 'store_checking'::public.order_status
        else o.status end,
        updated_at = now()
    where o.id = v_order_id;
  end loop;
  return jsonb_array_length(p_drafts);
end;
$$;

revoke all on function public.prepare_pickup_order_drafts(date, jsonb, jsonb) from public, anon;
grant execute on function public.prepare_pickup_order_drafts(date, jsonb, jsonb) to authenticated;

create or replace function public.finalize_pickup_order_batch(p_pickup_date date, p_orders jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb;
  v_result record;
  v_results jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_note text;
  v_reason public.refund_reason;
  v_product record;
  v_confirmed_for_product integer;
  v_item_count integer;
  v_distinct_item_count integer;
  v_bad_item boolean;
begin
  if not public.is_operator() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_orders), 'null') <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception '최종 확정할 주문을 확인해주세요.' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_orders) loop
    v_order_id := (v_entry ->> 'order_id')::uuid;
    select count(*) into v_item_count from public.order_items where order_id = v_order_id;
    if coalesce(jsonb_typeof(v_entry -> 'confirmed_items'), 'null') <> 'array' then
      raise exception '주문 상품 수량이 모두 포함되지 않았습니다.' using errcode = '22023';
    end if;
    select count(*), count(distinct (item.value ->> 'order_item_id')::uuid)
    into v_item_count, v_distinct_item_count
    from jsonb_array_elements(v_entry -> 'confirmed_items') as item(value);
    if v_item_count <> (select count(*) from public.order_items where order_id = v_order_id)
      or v_item_count <> v_distinct_item_count then
      raise exception '주문 상품이 중복되었거나 누락되었습니다.' using errcode = '22023';
    end if;
    select exists (
      select 1 from jsonb_array_elements(v_entry -> 'confirmed_items') as item(value)
      left join public.order_items oi on oi.id = (item.value ->> 'order_item_id')::uuid and oi.order_id = v_order_id
      where oi.id is null
        or item.value ->> 'confirmed_quantity' is null
        or (item.value ->> 'confirmed_quantity')::integer < 0
        or (item.value ->> 'confirmed_quantity')::integer > oi.quantity
    ) into v_bad_item;
    if v_bad_item then raise exception '주문 상품별 확정 수량이 주문 수량을 벗어났습니다.' using errcode = '22023'; end if;
  end loop;

  for v_product in
    select distinct oi.product_id, p.type, p.slot_size, inv.available_quantity
    from jsonb_array_elements(p_orders) as entry(value)
    cross join lateral jsonb_array_elements(entry.value -> 'confirmed_items') as item(value)
    join public.order_items oi on oi.id = (item.value ->> 'order_item_id')::uuid
    join public.products p on p.id = oi.product_id
    left join public.pickup_product_inventory inv on inv.product_id = oi.product_id
      and inv.pickup_date = p_pickup_date
  loop
    if v_product.available_quantity is null then
      raise exception '상품별 가게 물량 초안이 없습니다. 물량을 다시 저장해주세요.' using errcode = '22023';
    end if;
    select coalesce(sum((item.value ->> 'confirmed_quantity')::integer), 0)::integer
    into v_confirmed_for_product
    from jsonb_array_elements(p_orders) as entry(value)
    cross join lateral jsonb_array_elements(entry.value -> 'confirmed_items') as item(value)
    join public.order_items oi on oi.id = (item.value ->> 'order_item_id')::uuid
    where oi.product_id = v_product.product_id;
    if v_confirmed_for_product > v_product.available_quantity then
      raise exception '주문별 조정 수량이 가게에서 가능한 상품 수를 넘었습니다.' using errcode = '22023';
    end if;
    if v_product.type = 'slot' and v_product.slot_size > 0 and mod(v_confirmed_for_product, v_product.slot_size) <> 0 then
      raise exception '슬롯 상품의 전체 확정 수량이 슬롯 경계와 맞지 않습니다.' using errcode = '22023';
    end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_orders) loop
    v_order_id := (v_entry ->> 'order_id')::uuid;
    v_note := left(trim(coalesce(v_entry ->> 'confirmation_note', '')), 500);
    v_reason := coalesce(nullif(v_entry ->> 'refund_reason', '')::public.refund_reason, 'quantity_unavailable');

    if not exists (
      select 1 from public.orders o
      where o.id = v_order_id and o.pickup_date = p_pickup_date and o.inventory_reviewed_at is not null
        and o.status in ('paid_recruiting', 'slot_confirmed', 'store_checking')
    ) then
      raise exception '1차 검토가 끝나지 않았거나 이미 처리된 주문이 있습니다.' using errcode = '22023';
    end if;

    select * into v_result
    from public.finalize_order_for_pickup(
      v_order_id,
      v_entry -> 'confirmed_items',
      v_reason,
      '가게 확인 결과 일부 수량을 준비하기 어려워 해당 금액을 환불합니다.'
    );

    if v_note <> '' then
      update public.pickup_passes pp
      set item_snapshot = coalesce((
        select jsonb_agg(item.value || jsonb_build_object('confirmation_note', v_note) order by item.ordinality)
        from jsonb_array_elements(pp.item_snapshot) with ordinality as item(value, ordinality)
      ), '[]'::jsonb)
      where pp.order_id = v_order_id;
      update public.refunds set message = v_note where order_id = v_order_id and transferred_at is null;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'order_id', v_order_id,
      'final_status', v_result.final_status,
      'refund_total', v_result.refund_total,
      'confirmed_total', v_result.confirmed_total
    ));
  end loop;

  return v_results;
end;
$$;

revoke all on function public.finalize_pickup_order_batch(date, jsonb) from public, anon;
grant execute on function public.finalize_pickup_order_batch(date, jsonb) to authenticated;
