alter table public.orders
  add column if not exists confirmation_note varchar(500) not null default '';
