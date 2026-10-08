alter table public.products
  drop constraint if exists slot_type_size;

alter table public.products
  add constraint slot_type_size
  check (
    (type = 'slot' and (slot_size is null or slot_size > 0))
    or (type = 'instant' and slot_size is null)
  );
