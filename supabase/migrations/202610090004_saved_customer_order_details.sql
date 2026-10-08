-- Customer-controlled saved order details for faster repeat checkout.
create table if not exists public.customer_order_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refund_bank text not null check (length(trim(refund_bank)) > 0),
  refund_account text not null check (length(trim(refund_account)) >= 5),
  refund_account_holder text not null check (length(trim(refund_account_holder)) > 0),
  depositor_name text not null check (length(trim(depositor_name)) > 0),
  updated_at timestamptz not null default now()
);

alter table public.customer_order_details enable row level security;
create policy "customers read own saved order details" on public.customer_order_details
  for select to authenticated using (user_id = (select auth.uid()));
create policy "customers save own order details" on public.customer_order_details
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "customers update own order details" on public.customer_order_details
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "customers delete own order details" on public.customer_order_details
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.customer_order_details to authenticated;
