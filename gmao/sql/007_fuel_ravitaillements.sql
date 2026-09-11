begin;

create table if not exists public.gmao_fuel_ravitaillements (
  id uuid primary key default gen_random_uuid(),
  site text not null references public.sites(name),
  date date not null,
  fournisseur text not null,
  bon_livraison text not null,
  type_carburant text not null default 'Diesel',
  quantite_litres numeric(16,3) not null check (quantite_litres >= 0),
  stock_avant numeric(16,3) not null check (stock_avant >= 0),
  stock_apres numeric(16,3) not null check (stock_apres = stock_avant + quantite_litres),
  camion text not null default '',
  receptionne_par text not null,
  commentaires text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
 );

create index if not exists gmao_fuel_ravitaillements_site_date_idx
  on public.gmao_fuel_ravitaillements(site, date desc);

commit;