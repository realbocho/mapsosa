-- Do not expire or cancel orders based on an assumed one-hour payment deadline.
-- Actual bank transfers are confirmed manually by an operator.
do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is not null then
    for v_job_id in execute
      'select jobid from cron.job where jobname = $1'
      using 'mapsosa-expire-unpaid-orders'
    loop
      execute 'select cron.unschedule($1)' using v_job_id;
    end loop;
  end if;
end;
$$;

drop function if exists public.cancel_expired_orders();
drop index if exists public.orders_due_status_idx;
alter table public.orders alter column payment_due_at set default now();
comment on column public.orders.payment_due_at is 'Legacy compatibility field; no payment deadline, automatic cancellation, or automatic deposit confirmation is tied to this value.';
