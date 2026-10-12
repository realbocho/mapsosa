create or replace function public.weekly_campaign_catalog(p_pickup_date date)
returns table (
  product_id uuid, store_id uuid, store_name text, store_area text, store_address text, closed_weekdays smallint[],
  name text, specification text, description text, image_url text, applied_quantity bigint,
  tiers jsonb
) language sql stable security definer set search_path = '' as $$
  select p.id, s.id, s.name, s.area, s.address, s.closed_weekdays, c.name, c.specification, c.description, c.image_url,
    coalesce((select sum(greatest(oi.quantity - oi.refund_quantity, 0))::bigint
      from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.product_id = p.id and o.pickup_date = c.pickup_date
        and o.paid_at is not null
        and o.status not in ('cancelled_unpaid','late_payment_refund','refunded')
        and not (o.cancellation_requested_at is not null and o.paid_at is null)), 0),
    (select jsonb_agg(jsonb_build_object('minimum_slots', t.minimum_slots, 'unit_price', t.unit_price) order by t.minimum_slots)
      from public.weekly_price_tiers t where t.campaign_store_id = cs.id)
  from public.weekly_campaigns c
  join public.weekly_campaign_stores cs on cs.campaign_id = c.id
  join public.products p on p.id = cs.product_id
  join public.stores s on s.id = cs.store_id
  where c.pickup_date = p_pickup_date and c.active and s.active and p.active
    and not (6::smallint = any(s.closed_weekdays))
  order by s.name;
$$;

revoke all on function public.weekly_campaign_catalog(date) from public;
grant execute on function public.weekly_campaign_catalog(date) to anon, authenticated;
