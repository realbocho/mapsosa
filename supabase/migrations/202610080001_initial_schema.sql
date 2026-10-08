-- Mapsosa MVP schema. Run with `supabase db push` or paste into Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.user_role as enum ('customer', 'operator');
create type public.product_type as enum ('slot', 'instant');
create type public.refund_preference as enum ('all_or_nothing', 'partial');
create type public.order_status as enum ('awaiting_payment', 'cancelled_unpaid', 'late_payment_refund', 'paid_recruiting', 'slot_confirmed', 'store_checking', 'partially_refunded', 'refunded', 'pickup_ready', 'picked_up', 'auto_completed');
create type public.refund_reason as enum ('slot_boundary', 'slot_unfilled', 'price_limit', 'quality', 'quantity_unavailable', 'urgent_store_unreachable', 'late_payment');
create type public.transfer_type as enum ('deposit', 'sales', 'recovery');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '이웃',
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null,
  address text not null,
  sms_phone text,
  opening_time time not null default '09:00',
  closing_time time not null default '20:00',
  closed_weekdays smallint[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint valid_weekdays check (closed_weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text not null,
  specification text not null,
  supply_price integer not null check (supply_price >= 0),
  consumer_price integer not null check (consumer_price >= 0),
  type public.product_type not null,
  slot_size integer,
  available_quantity integer,
  description text not null default '',
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint slot_type_size check ((type = 'slot' and slot_size is not null and slot_size > 0) or (type = 'instant' and slot_size is null))
);

create table public.price_comparisons (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  vendor text not null,
  price integer not null check (price >= 0),
  specification text not null,
  url text,
  note text,
  checked_at timestamptz not null default now()
);

create table public.pickup_rounds (
  id uuid primary key default gen_random_uuid(),
  pickup_date date not null,
  order_deadline timestamptz not null,
  slot_confirmation_at timestamptz not null,
  store_sms_at timestamptz not null,
  store_response_deadline timestamptz not null,
  customer_notice_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pickup_wed_or_sat check (extract(isodow from pickup_date) in (3, 6))
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('MS-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))),
  user_id uuid not null references public.profiles(id),
  round_id uuid not null references public.pickup_rounds(id),
  refund_preference public.refund_preference not null,
  refund_bank text not null,
  refund_account text not null,
  refund_account_holder text not null,
  depositor_name text not null,
  subtotal integer not null default 0 check (subtotal >= 0),
  service_fee integer not null default 0 check (service_fee >= 0),
  total integer not null default 0 check (total >= 0),
  status public.order_status not null default 'awaiting_payment',
  payment_due_at timestamptz not null default (now() + interval '1 hour'),
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  confirmed_quantity integer check (confirmed_quantity >= 0),
  refund_quantity integer not null default 0 check (refund_quantity >= 0),
  slot_sequence_start integer,
  slot_sequence_end integer,
  refund_reason public.refund_reason,
  unit_price integer not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.store_checks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.pickup_rounds(id),
  store_id uuid not null references public.stores(id),
  submitted_at timestamptz,
  phone_follow_up text,
  unique (round_id, store_id)
);

create table public.store_check_items (
  id uuid primary key default gen_random_uuid(),
  store_check_id uuid not null references public.store_checks(id) on delete cascade,
  product_id uuid not null references public.products(id),
  available boolean not null default false,
  available_quantity integer check (available_quantity >= 0),
  actual_price integer check (actual_price >= 0),
  note text
);

create table public.pickup_passes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  issued_at timestamptz not null default now(),
  auto_complete_at timestamptz,
  completed_at timestamptz
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  reason public.refund_reason not null,
  amount integer not null check (amount >= 0),
  message text not null,
  transferred_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.store_transfers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.pickup_rounds(id),
  store_id uuid not null references public.stores(id),
  type public.transfer_type not null,
  amount integer not null check (amount >= 0),
  transferred_at timestamptz,
  memo text not null default '',
  created_at timestamptz not null default now()
);

create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_due_status_idx on public.orders(status, payment_due_at);
create index order_items_product_idx on public.order_items(product_id, created_at);
create index products_store_active_idx on public.products(store_id, active);
create index rounds_pickup_date_idx on public.pickup_rounds(pickup_date);

-- A single authenticated RPC keeps order totals, prices, and item creation on the database side.
create function public.create_order(
  p_round_id uuid,
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
  v_round public.pickup_rounds%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_due_at timestamptz := now() + interval '1 hour';
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if length(trim(p_refund_bank)) = 0 or length(trim(p_refund_account)) < 5 or length(trim(p_refund_account_holder)) = 0 or length(trim(p_depositor_name)) = 0 then
    raise exception '환불 계좌와 입금자 정보를 입력해주세요.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception '주문 상품을 확인해주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception '주문 상품을 확인해주세요.' using errcode = '22023';
  end if;
  select * into v_round from public.pickup_rounds where id = p_round_id and order_deadline > now();
  if not found then raise exception '주문 마감이 지났거나 픽업 회차가 없습니다.' using errcode = '22023'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 100 then raise exception '상품 수량을 확인해주세요.' using errcode = '22023'; end if;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and active = true;
    if not found then raise exception '판매 중인 상품만 주문할 수 있습니다.' using errcode = '22023'; end if;
    v_subtotal := v_subtotal + v_product.consumer_price * v_quantity;
  end loop;

  insert into public.orders (user_id, round_id, refund_preference, refund_bank, refund_account, refund_account_holder, depositor_name, subtotal, total, payment_due_at)
  values (v_user_id, p_round_id, p_refund_preference, trim(p_refund_bank), trim(p_refund_account), trim(p_refund_account_holder), trim(p_depositor_name), v_subtotal, v_subtotal, v_due_at)
  returning id, orders.order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and active = true;
    insert into public.order_items (order_id, product_id, quantity, unit_price)
    values (v_order_id, v_product.id, v_quantity, v_product.consumer_price);
  end loop;

  return query select v_order_id, v_order_number, v_subtotal, v_due_at;
end;
$$;
revoke all on function public.create_order(uuid, public.refund_preference, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_order(uuid, public.refund_preference, text, text, text, text, jsonb) to authenticated;

create function public.cancel_expired_orders() returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.orders
  set status = 'cancelled_unpaid', cancelled_at = now(), updated_at = now()
  where status = 'awaiting_payment' and paid_at is null and payment_due_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.cancel_expired_orders() from public, anon, authenticated;

-- Supabase Cron (pg_cron) runs the one-hour transfer deadline check every minute.
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'mapsosa-expire-unpaid-orders';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('mapsosa-expire-unpaid-orders', '* * * * *', 'select public.cancel_expired_orders();');
end;
$$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname', '이웃'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create function public.is_operator() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'operator');
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.price_comparisons enable row level security;
alter table public.pickup_rounds enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.store_checks enable row level security;
alter table public.store_check_items enable row level security;
alter table public.pickup_passes enable row level security;
alter table public.refunds enable row level security;
alter table public.store_transfers enable row level security;

create policy "profiles read own" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_operator());
create policy "profiles edit own nickname" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = 'customer');
create policy "active stores are public" on public.stores for select to anon, authenticated using (active or public.is_operator());
create policy "operators manage stores" on public.stores for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "active products are public" on public.products for select to anon, authenticated using (active or public.is_operator());
create policy "operators manage products" on public.products for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "comparisons are public" on public.price_comparisons for select to anon, authenticated using (true);
create policy "operators manage comparisons" on public.price_comparisons for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "pickup rounds are public" on public.pickup_rounds for select to anon, authenticated using (true);
create policy "operators manage rounds" on public.pickup_rounds for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "users read own orders" on public.orders for select to authenticated using (user_id = (select auth.uid()) or public.is_operator());
create policy "operators update orders" on public.orders for update to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "users read own order items" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.is_operator())));
create policy "operators update order items" on public.order_items for update to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators manage store checks" on public.store_checks for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators manage store check items" on public.store_check_items for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "users read own pickup pass" on public.pickup_passes for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.is_operator())));
create policy "operators manage pickup passes" on public.pickup_passes for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "users read own refunds" on public.refunds for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.is_operator())));
create policy "operators manage refunds" on public.refunds for all to authenticated using (public.is_operator()) with check (public.is_operator());
create policy "operators manage transfers" on public.store_transfers for all to authenticated using (public.is_operator()) with check (public.is_operator());

comment on table public.products is 'Products use a fixed consumer price as the maximum procurement price. Slot quantities are set-only for type=slot.';
comment on column public.pickup_rounds.order_deadline is 'Day before pickup at 10:00 local time (Asia/Seoul).';
comment on table public.orders is 'Bank transfer orders; payment deadlines are one hour after order creation, including late cutoff orders.';
