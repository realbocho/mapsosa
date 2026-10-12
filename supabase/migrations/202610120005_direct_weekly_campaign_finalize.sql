-- Simple campaign close: keep every paid quantity and issue pickup passes directly.
create or replace function public.finalize_weekly_campaign_orders(
  p_pickup_date date,
  p_confirmation_notes jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_line record;
  v_result record;
  v_items jsonb;
  v_note text;
  v_product record;
  v_total_quantity integer;
  v_final_price integer;
  v_finalized_count integer := 0;
  v_price_result jsonb := '[]'::jsonb;
begin
  if not public.is_operator() then raise exception '관리자 권한이 필요합니다.' using errcode = '42501'; end if;
  if p_pickup_date is null or extract(isodow from p_pickup_date) <> 6 then
    raise exception '토요일 픽업일만 확정할 수 있습니다.' using errcode = '22023';
  end if;
  if now() < ((p_pickup_date - 1)::timestamp + time '11:00') at time zone 'Asia/Seoul' then
    raise exception '주문서 발급은 픽업 전날 오전 11시부터 할 수 있습니다.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mapsosa-weekly-' || p_pickup_date::text, 0));
  if not exists (select 1 from public.weekly_campaigns c where c.pickup_date=p_pickup_date and c.active) then
    raise exception '해당 픽업일의 단일 상품이 등록되지 않았습니다.' using errcode = '22023';
  end if;

  for v_order in
    select o.* from public.orders o
    where o.pickup_date=p_pickup_date and o.paid_at is not null
      and o.status in ('paid_recruiting','slot_confirmed','store_checking')
      and o.cancellation_requested_at is null
      and exists (
        select 1 from public.order_items oi
        join public.weekly_campaign_stores cs on cs.product_id=oi.product_id
        join public.weekly_campaigns c on c.id=cs.campaign_id and c.pickup_date=o.pickup_date and c.active
        where oi.order_id=o.id
      )
    order by o.created_at, o.id
    for update of o
  loop
    select coalesce(jsonb_agg(jsonb_build_object('order_item_id',oi.id,'confirmed_quantity',oi.quantity) order by oi.created_at),'[]'::jsonb)
      into v_items from public.order_items oi where oi.order_id=v_order.id;
    v_note := left(trim(coalesce(p_confirmation_notes->>v_order.id::text,v_order.confirmation_note,'')),500);
    update public.orders set confirmation_note=v_note where id=v_order.id;
    select * into v_result from public.finalize_order_for_pickup(v_order.id,v_items,'quantity_unavailable'::public.refund_reason,'');
    if v_result.refund_total <> 0 or v_result.confirmed_total <> (select coalesce(sum(oi.quantity),0) from public.order_items oi where oi.order_id=v_order.id) then
      raise exception '주문 수량을 그대로 확정하지 못했습니다.' using errcode = '22023';
    end if;
    if v_note <> '' then
      update public.pickup_passes pp set item_snapshot=coalesce((
        select jsonb_agg(item.value||jsonb_build_object('confirmation_note',v_note) order by item.ordinality)
        from jsonb_array_elements(pp.item_snapshot) with ordinality item(value,ordinality)
      ),'[]'::jsonb) where pp.order_id=v_order.id;
    end if;
    v_finalized_count := v_finalized_count + 1;
  end loop;

  for v_product in
    select cs.id as campaign_store_id, cs.product_id, s.name as store_name, c.name as item_name
    from public.weekly_campaign_stores cs
    join public.weekly_campaigns c on c.id=cs.campaign_id
    join public.stores s on s.id=cs.store_id
    where c.pickup_date=p_pickup_date and c.active
  loop
    select coalesce(sum(oi.confirmed_quantity),0)::integer into v_total_quantity
    from public.order_items oi join public.orders o on o.id=oi.order_id
    where oi.product_id=v_product.product_id and o.pickup_date=p_pickup_date
      and oi.confirmed_quantity is not null and o.status in ('pickup_ready','picked_up','auto_completed');
    if v_total_quantity=0 then continue; end if;
    select t.unit_price into v_final_price from public.weekly_price_tiers t
    where t.campaign_store_id=v_product.campaign_store_id and t.minimum_slots<=v_total_quantity
    order by t.minimum_slots desc limit 1;
    if v_final_price is null then raise exception '최종 가격 구간을 찾지 못했습니다: %',v_product.store_name using errcode = '22023'; end if;
    for v_line in
      select oi.id, oi.order_id, oi.confirmed_quantity, oi.unit_price from public.order_items oi
      join public.orders o on o.id=oi.order_id
      where oi.product_id=v_product.product_id and o.pickup_date=p_pickup_date
        and oi.confirmed_quantity>0 and oi.final_unit_price is null
        and o.status in ('pickup_ready','picked_up','auto_completed')
    loop
      update public.order_items set final_unit_price=least(v_line.unit_price,v_final_price) where id=v_line.id;
      if v_line.unit_price>v_final_price then
        insert into public.refunds(order_id,order_item_id,reason,amount,message)
        values(v_line.order_id,v_line.id,'quantity_unavailable',
          (v_line.unit_price-v_final_price)*v_line.confirmed_quantity,
          '가게 최종 주문량이 낮은 가격 구간에 도달해 차액을 환불합니다.');
      end if;
    end loop;
    v_price_result := v_price_result || jsonb_build_array(jsonb_build_object(
      'store_id',(select cs.store_id from public.weekly_campaign_stores cs where cs.id=v_product.campaign_store_id),
      'store_name',v_product.store_name,'item_name',v_product.item_name,
      'quantity',v_total_quantity,'unit_price',v_final_price,'amount',v_total_quantity*v_final_price
    ));
  end loop;
  return jsonb_build_object('finalized_orders',v_finalized_count,'stores',v_price_result);
end;
$$;
revoke all on function public.finalize_weekly_campaign_orders(date,jsonb) from public, anon;
grant execute on function public.finalize_weekly_campaign_orders(date,jsonb) to authenticated;
