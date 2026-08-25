-- Tables métier GMAO ORDC. À exécuter une seule fois dans Supabase SQL Editor.
begin;

create extension if not exists pgcrypto;

create table if not exists public.gmao_equipements (
  id uuid primary key default gen_random_uuid(), site text not null, code text not null,
  nom text not null, date_mise_en_service date not null, famille text not null,
  localisation text not null, marque_modele text not null, etat text not null,
  criticite text not null, created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(), updated_by uuid references public.user_profiles(id),
  updated_at timestamptz not null default now(), unique (site, code)
);

create table if not exists public.gmao_tickets (
  id uuid primary key default gen_random_uuid(), site text not null, numero text not null,
  nature text not null, equipement text not null, date date not null, porteur text not null,
  entreprise text not null, motif text not null, description text not null,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now(),
  unique (site, numero)
);

create table if not exists public.gmao_groupes_electrogenes (
  id uuid primary key default gen_random_uuid(), site text not null, type_ge text not null,
  mois_releve text not null, date_mise_en_service date not null, date_derniere_pm date not null,
  rh_depuis_derniere_pm numeric(14,2) not null, rh_prochaine_pm numeric(14,2) not null,
  etat text not null, commentaires text not null default '',
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now()
);

create table if not exists public.gmao_fuel_ge (
  id uuid primary key default gen_random_uuid(), site text not null, periode text not null,
  stock_initial numeric(16,2) not null, entree numeric(16,2) not null, sortie numeric(16,2) not null,
  stock_final numeric(16,2) not null, heures_ge numeric(14,2) not null,
  litres_heure numeric(14,2) not null, snel_kwh numeric(16,2) not null,
  disponibilite_grid numeric(7,2) not null, etat text not null,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now(),
  unique (site, periode)
);

create table if not exists public.gmao_pue (
  id uuid primary key default gen_random_uuid(), site text not null, mois text not null,
  energie_it numeric(18,2) not null, energie_totale numeric(18,2) not null,
  pue numeric(8,2) not null,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now(),
  unique (site, mois)
);

create table if not exists public.gmao_problemes_datacenter (
  id uuid primary key default gen_random_uuid(), site text not null, date date not null,
  equipement text not null, constat text not null, statut text not null default 'Open',
  priorite text not null, responsable text not null, echeance date,
  besoin_spare boolean not null default false, prochaine_etape text not null default '',
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now()
);

create table if not exists public.gmao_interventions (
  id uuid primary key default gen_random_uuid(), site text not null, ticket_number text not null,
  date date not null, equipement text not null, type text not null, travail_realise text not null,
  agent text not null, duree_heures numeric(10,2) not null, statut text not null,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now()
);

create table if not exists public.gmao_pieces_rechange (
  id uuid primary key default gen_random_uuid(), site text not null, date date not null,
  ticket_number text not null, equipement text not null, designation text not null,
  quantite numeric(14,2) not null check (quantite > 0), agent text not null, statut text not null,
  created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now()
);

create index if not exists idx_gmao_equipements_site on public.gmao_equipements(site);
create index if not exists idx_gmao_tickets_site on public.gmao_tickets(site);
create index if not exists idx_gmao_groupes_site on public.gmao_groupes_electrogenes(site);
create index if not exists idx_gmao_fuel_site on public.gmao_fuel_ge(site);
create index if not exists idx_gmao_pue_site on public.gmao_pue(site);
create index if not exists idx_gmao_problemes_site on public.gmao_problemes_datacenter(site);
create index if not exists idx_gmao_interventions_site on public.gmao_interventions(site);
create index if not exists idx_gmao_pieces_site on public.gmao_pieces_rechange(site);

alter table public.gmao_equipements enable row level security;
alter table public.gmao_tickets enable row level security;
alter table public.gmao_groupes_electrogenes enable row level security;
alter table public.gmao_fuel_ge enable row level security;
alter table public.gmao_pue enable row level security;
alter table public.gmao_problemes_datacenter enable row level security;
alter table public.gmao_interventions enable row level security;
alter table public.gmao_pieces_rechange enable row level security;

revoke all on public.gmao_equipements, public.gmao_tickets, public.gmao_groupes_electrogenes,
  public.gmao_fuel_ge, public.gmao_pue, public.gmao_problemes_datacenter,
  public.gmao_interventions, public.gmao_pieces_rechange from anon, authenticated;

commit;
