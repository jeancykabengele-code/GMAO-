begin;
create table if not exists public.gmao_fuel_ravitaillements (
  id uuid primary key default gen_random_uuid(),
  site text not null references public.sites(name),
  date_ravitaillement date not null,
  fournisseur text not null,
  bon_livraison text not null,
  type_carburant text not null default 'Diesel',
  quantite_recue numeric(16,3) not null check (quantite_recue >= 0),
  stock_avant numeric(16,3) not null check (stock_avant >= 0),
  stock_apres numeric(16,3) not null check (stock_apres >= 0),
  numero_citerne text not null default '',
  receptionne_par text not null,
  commentaires text not null default '',
  difference_stock boolean not null default false,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_gmao_fuel_ravitaillements_site_date on public.gmao_fuel_ravitaillements(site, date_ravitaillement desc);
alter table public.gmao_fuel_ravitaillements enable row level security;
revoke all on public.gmao_fuel_ravitaillements from anon, authenticated;
commit;