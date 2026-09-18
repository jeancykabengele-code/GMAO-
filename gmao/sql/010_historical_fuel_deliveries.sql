begin;
alter table public.gmao_fuel_ravitaillements
  alter column stock_avant drop not null,
  alter column stock_apres drop not null;
commit;