create table public.pickup_net_profits (
  pickup_date date primary key,
  amount bigint not null,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint pickup_net_profit_wed_or_sat check (extract(isodow from pickup_date) in (3, 6))
);

alter table public.pickup_net_profits enable row level security;

create policy "operators manage pickup net profits"
  on public.pickup_net_profits
  for all to authenticated
  using (public.is_operator())
  with check (public.is_operator());

grant select, insert, update on public.pickup_net_profits to authenticated;
