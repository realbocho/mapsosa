-- Test-data reset for Mapsosa. Run manually in Supabase SQL Editor.
-- Keeps the administrator login/profile, stores, products, product comparisons,
-- and payment settings. Stops if any order belongs to a non-admin account.
begin;

do $$
begin
  if exists (
    select 1 from public.orders
    where user_id <> 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid
  ) then
    raise exception 'Non-admin orders exist; reset stopped without deleting data.';
  end if;
end;
$$;

delete from public.marketing_spend;
delete from public.analytics_events;
delete from public.acquisition_surveys;
delete from public.customer_order_details
  where user_id = 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid;
delete from public.store_transfers;
delete from public.store_checks;
delete from public.orders
  where user_id = 'f022cd30-1a39-457b-adaf-48f3c109965d'::uuid;
delete from public.pickup_rounds;

commit;
