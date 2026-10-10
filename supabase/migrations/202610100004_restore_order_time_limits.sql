create or replace function public.enforce_order_time_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_deadline timestamptz;
  v_store_review_opens timestamptz;
begin
  v_order_deadline := ((new.pickup_date - 1)::timestamp + time '10:00') at time zone 'Asia/Seoul';
  v_store_review_opens := ((new.pickup_date - 1)::timestamp + time '11:00') at time zone 'Asia/Seoul';

  if tg_op = 'INSERT' and now() >= v_order_deadline then
    raise exception '주문 마감이 지났어요. 다음 픽업 날짜를 선택해주세요.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.cancellation_requested_at is distinct from old.cancellation_requested_at
      and new.cancellation_requested_at is not null
      and now() >= v_order_deadline then
      raise exception '취소·환불 요청은 픽업 전날 오전 10시까지만 할 수 있어요.' using errcode = '22023';
    end if;

    if old.status = 'awaiting_payment' and new.status = 'cancelled_unpaid'
      and now() >= v_order_deadline then
      raise exception '주문 취소는 픽업 전날 오전 10시까지만 할 수 있어요.' using errcode = '22023';
    end if;

    if new.inventory_reviewed_at is distinct from old.inventory_reviewed_at
      and new.inventory_reviewed_at is not null
      and now() < v_store_review_opens then
      raise exception '가게 물량 확인과 주문서 1차 확정은 픽업 전날 오전 11시부터 할 수 있어요.' using errcode = '22023';
    end if;

    if old.status::text in ('paid_recruiting', 'slot_confirmed', 'store_checking')
      and new.status::text in ('pickup_ready', 'partially_refunded', 'refunded')
      and now() < v_store_review_opens then
      raise exception '주문서 최종 확정은 픽업 전날 오전 11시부터 할 수 있어요.' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_order_time_limits on public.orders;
create trigger enforce_order_time_limits
before insert or update on public.orders
for each row execute function public.enforce_order_time_limits();

revoke all on function public.enforce_order_time_limits() from public, anon, authenticated;
