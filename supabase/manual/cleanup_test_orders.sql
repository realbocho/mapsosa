-- One-time cleanup for the operator's test run after test mode was enabled.
-- The test account UUID was supplied by the operator. Cascading foreign keys
-- remove its order items, pickup passes, and refunds with each order.
with test_orders as materialized (
  select id, pickup_date, order_number
  from public.orders
  where user_id = 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
    and created_at >= timestamptz '2026-10-10 17:03:56+09'
    and created_at < now()
),
test_dates as materialized (
  select distinct pickup_date from test_orders
),
deleted_inventory as (
  delete from public.pickup_product_inventory
  where pickup_date in (select pickup_date from test_dates)
  returning pickup_date
),
deleted_orders as (
  delete from public.orders
  where id in (select id from test_orders)
  returning order_number
)
select
  (select count(*) from deleted_orders) as deleted_orders,
  (select count(*) from deleted_inventory) as deleted_inventory_rows,
  (select coalesce(jsonb_agg(order_number), '[]'::jsonb) from deleted_orders) as deleted_order_numbers;
