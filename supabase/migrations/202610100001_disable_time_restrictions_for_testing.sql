-- TEMPORARY TEST MODE: remove pickup order and cancellation time cutoffs.
-- Restore normal rules after testing by reapplying the deadline checks from
-- 202610080005_customer_orders_and_pickup.sql and
-- 202610090001_enforce_customer_cancellation_deadline.sql.

create or replace function public.create_order(
  p_pickup_date date,
  p_refund_preference public.refund_preference,
  p_refund_bank text,
  p_refund_account text,
  p_refund_account_holder text,
  p_depositor_name text,
  p_items jsonb
) returns table (order_id uuid, order_number text, total integer, payment_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_due_at timestamptz := now();
  v_payment public.payment_settings%rowtype;
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_pickup_date is null or p_pickup_date < (now() at time zone 'Asia/Seoul')::date or extract(isodow from p_pickup_date) not in (3, 6) then
    raise exception '수요일 또는 토요일 픽업 날짜를 선택해주세요.' using errcode = '22023';
  end if;
  if length(trim(p_refund_bank)) = 0 or length(trim(p_refund_account)) < 5 or length(trim(p_refund_account_holder)) = 0 or length(trim(p_depositor_name)) = 0 then
    raise exception '환불 계좌와 입금자 정보를 입력해주세요.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception '주문 상품을 확인해주세요.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then raise exception '주문 상품을 확인해주세요.' using errcode = '22023'; end if;
  select * into v_payment from public.payment_settings where singleton = true;
  if not found or length(trim(coalesce(v_payment.account_number, ''))) = 0 then
    raise exception '입금 계좌 설정이 완료되지 않아 주문을 접수할 수 없어요.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 100 then raise exception '상품 수량을 확인해주세요.' using errcode = '22023'; end if;
    select p.* into v_product from public.products p join public.stores s on s.id = p.store_id
    where p.id = (v_item ->> 'product_id')::uuid and p.active = true and s.active = true
      and not ((extract(dow from p_pickup_date)::smallint) = any(s.closed_weekdays));
    if not found then raise exception '선택한 픽업일에 주문할 수 없는 상품이 있어요.' using errcode = '22023'; end if;
    v_subtotal := v_subtotal + v_product.consumer_price * v_quantity;
  end loop;
  insert into public.orders (user_id, pickup_date, refund_preference, refund_bank, refund_account, refund_account_holder, depositor_name, subtotal, total, payment_due_at, payment_bank, payment_account, payment_account_holder)
  values (v_user_id, p_pickup_date, p_refund_preference, trim(p_refund_bank), trim(p_refund_account), trim(p_refund_account_holder), trim(p_depositor_name), v_subtotal, v_subtotal, v_due_at, v_payment.bank_name, v_payment.account_number, v_payment.account_holder)
  returning id, orders.order_number into v_order_id, v_order_number;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and active = true;
    insert into public.order_items (order_id, product_id, quantity, unit_price) values (v_order_id, v_product.id, v_quantity, v_product.consumer_price);
  end loop;
  return query select v_order_id, v_order_number, v_subtotal, v_due_at;
end;
$$;
revoke all on function public.create_order(date, public.refund_preference, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_order(date, public.refund_preference, text, text, text, text, jsonb) to authenticated;

create or replace function public.cancel_my_order(p_order_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception '주문을 찾을 수 없어요.' using errcode = 'P0002'; end if;
  if v_order.status = 'awaiting_payment' and v_order.paid_at is null then
    update public.orders set status = 'cancelled_unpaid', cancelled_at = now(), cancel_reason = 'customer_cancelled', updated_at = now() where id = p_order_id;
    return 'cancelled';
  end if;
  if v_order.status in ('cancelled_unpaid', 'refunded', 'picked_up', 'auto_completed') then
    raise exception '이미 취소되었거나 종료된 주문입니다.' using errcode = '22023';
  end if;
  update public.orders set cancellation_requested_at = coalesce(cancellation_requested_at, now()), updated_at = now() where id = p_order_id;
  return 'requested';
end;
$$;
revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;
