-- Use buyer-provided nicknames as the assisted-buyer identity instead of phone numbers.
alter table public.assisted_customers
  add column if not exists nickname text,
  add column if not exists normalized_nickname text;

-- Existing phone-based identities cannot be reliably converted to real nicknames.
-- Keep each identity distinct under an explicit legacy label, preserving order links.
update public.assisted_customers
set nickname = '기존 대리 구매자 ' || left(id::text, 8),
    normalized_nickname = '기존 대리 구매자 ' || left(id::text, 8)
where nickname is null or normalized_nickname is null;

alter table public.assisted_customers
  alter column nickname set not null,
  alter column normalized_nickname set not null;
create unique index if not exists assisted_customers_normalized_nickname_key
  on public.assisted_customers(normalized_nickname);
alter table public.assisted_customers
  drop column if exists phone_number,
  drop column if exists normalized_phone;

drop function if exists public.create_assisted_order(date, text, uuid, text, public.refund_preference, text, text, text, text, jsonb);

create function public.create_assisted_order(
  p_pickup_date date,
  p_customer_nickname text,
  p_linked_profile_id uuid,
  p_acquisition_channel text,
  p_refund_preference public.refund_preference,
  p_refund_bank text,
  p_refund_account text,
  p_refund_account_holder text,
  p_depositor_name text,
  p_items jsonb
) returns table (order_id uuid, order_number text, total integer, payment_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_operator_id uuid := auth.uid();
  v_nickname text := nullif(regexp_replace(trim(coalesce(p_customer_nickname, '')), '\s+', ' ', 'g'), '');
  v_normalized_nickname text;
  v_customer_id uuid;
  v_linked_profile_id uuid;
  v_channel text := nullif(trim(coalesce(p_acquisition_channel, '')), '');
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_due_at timestamptz := now();
  v_deadline timestamptz;
  v_payment public.payment_settings%rowtype;
begin
  if v_operator_id is null or not public.is_operator() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if v_nickname is null or length(v_nickname) > 40 then
    raise exception '구매자의 닉네임을 1~40자로 입력해 주세요.' using errcode = '22023';
  end if;
  v_normalized_nickname := lower(v_nickname);
  if v_channel is not null and v_channel not in ('friend_referral', 'kakao_group', 'search', 'social_community', 'paid_ad', 'store_offline', 'other', 'unknown') then
    raise exception '유입 경로를 확인해 주세요.' using errcode = '22023';
  end if;
  if p_pickup_date is null or p_pickup_date < (now() at time zone 'Asia/Seoul')::date or extract(isodow from p_pickup_date) not in (3, 6) then
    raise exception '수요일 또는 토요일 픽업 날짜를 선택해 주세요.' using errcode = '22023';
  end if;
  v_deadline := ((p_pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul';
  if now() >= v_deadline then raise exception '주문 마감이 지났어요. 다음 픽업 날짜를 선택해 주세요.' using errcode = '22023'; end if;
  if p_refund_preference is null or length(trim(coalesce(p_refund_bank, ''))) = 0
    or length(trim(coalesce(p_refund_account, ''))) < 5
    or length(trim(coalesce(p_refund_account_holder, ''))) = 0
    or length(trim(coalesce(p_depositor_name, ''))) = 0 then
    raise exception '환불 계좌와 입금자 정보를 모두 입력해 주세요.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception '주문 상품을 확인해 주세요.' using errcode = '22023';
  end if;
  if p_linked_profile_id is not null then
    select id into v_linked_profile_id from public.profiles
    where id = p_linked_profile_id and role = 'customer' and id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid;
    if not found then raise exception '연결할 고객 계정을 확인해 주세요.' using errcode = '22023'; end if;
  end if;
  select * into v_payment from public.payment_settings where singleton = true;
  if not found or length(trim(coalesce(v_payment.account_number, ''))) = 0 then
    raise exception '입금 계좌 설정이 완료되지 않아 주문을 접수할 수 없어요.' using errcode = '22023';
  end if;

  insert into public.assisted_customers(nickname, normalized_nickname, linked_profile_id, acquisition_channel, last_order_at)
  values (v_nickname, v_normalized_nickname, v_linked_profile_id, v_channel, now())
  on conflict (normalized_nickname) do update set
    nickname = excluded.nickname,
    linked_profile_id = coalesce(public.assisted_customers.linked_profile_id, excluded.linked_profile_id),
    acquisition_channel = coalesce(public.assisted_customers.acquisition_channel, excluded.acquisition_channel),
    last_order_at = now()
  where public.assisted_customers.linked_profile_id is null
     or excluded.linked_profile_id is null
     or public.assisted_customers.linked_profile_id = excluded.linked_profile_id
  returning id into v_customer_id;
  if v_customer_id is null then
    raise exception '이 닉네임은 다른 맵소사 계정과 이미 연결되어 있어요. 동명이인은 구분되는 닉네임을 입력해 주세요.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception '상품 수량을 확인해 주세요.' using errcode = '22023';
    end;
    if v_quantity < 1 or v_quantity > 100 then raise exception '상품 수량을 확인해 주세요.' using errcode = '22023'; end if;
    select p.* into v_product from public.products p join public.stores s on s.id = p.store_id
    where p.id = (v_item ->> 'product_id')::uuid and p.active = true and s.active = true
      and not ((extract(dow from p_pickup_date)::smallint) = any(s.closed_weekdays));
    if not found then raise exception '선택한 픽업일에 주문할 수 없는 상품이 있어요.' using errcode = '22023'; end if;
    v_subtotal := v_subtotal + v_product.consumer_price * v_quantity;
  end loop;

  insert into public.orders(user_id, pickup_date, refund_preference, refund_bank, refund_account, refund_account_holder, depositor_name,
    subtotal, total, payment_due_at, payment_bank, payment_account, payment_account_holder, order_source, assisted_customer_id)
  values (v_operator_id, p_pickup_date, p_refund_preference, trim(p_refund_bank), trim(p_refund_account), trim(p_refund_account_holder), trim(p_depositor_name),
    v_subtotal, v_subtotal, v_due_at, v_payment.bank_name, v_payment.account_number, v_payment.account_holder, 'assisted', v_customer_id)
  returning id, orders.order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and active = true;
    insert into public.order_items(order_id, product_id, quantity, unit_price)
    values (v_order_id, v_product.id, v_quantity, v_product.consumer_price);
  end loop;

  return query select v_order_id, v_order_number, v_subtotal, v_due_at;
end;
$$;
revoke all on function public.create_assisted_order(date, text, uuid, text, public.refund_preference, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_assisted_order(date, text, uuid, text, public.refund_preference, text, text, text, text, jsonb) to authenticated;
