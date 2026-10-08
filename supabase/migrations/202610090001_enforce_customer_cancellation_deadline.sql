create or replace function public.cancel_my_order(p_order_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception '주문을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if now() >= (((v_order.pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul') then
    raise exception '취소·환불 요청은 픽업 전날 오전 10시까지만 할 수 있어요.' using errcode = '22023';
  end if;

  if v_order.status = 'awaiting_payment' and v_order.paid_at is null then
    update public.orders
    set status = 'cancelled_unpaid', cancelled_at = now(), cancel_reason = 'customer_cancelled', updated_at = now()
    where id = p_order_id;
    return 'cancelled';
  end if;

  if v_order.status in ('cancelled_unpaid', 'refunded', 'picked_up', 'auto_completed') then
    raise exception '이미 취소되었거나 종료된 주문입니다.' using errcode = '22023';
  end if;

  update public.orders
  set cancellation_requested_at = coalesce(cancellation_requested_at, now()), updated_at = now()
  where id = p_order_id;
  return 'requested';
end;
$$;

revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;
