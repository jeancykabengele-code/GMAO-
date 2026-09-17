begin;
create table if not exists public.gmao_consommations_groupes_ge (
 id uuid primary key default gen_random_uuid(), site text not null references public.sites(name), periode text not null, groupe_code text not null, consommation_litres numeric(16,3) not null check(consommation_litres>=0), heures_ge numeric(14,2) not null check(heures_ge>=0), litres_heure numeric(14,3), commentaires text not null default '', created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(), updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now(), unique(site,periode,groupe_code));
create index if not exists idx_consommations_ge_site_periode on public.gmao_consommations_groupes_ge(site, periode desc);
alter table public.gmao_consommations_groupes_ge enable row level security;
revoke all on public.gmao_consommations_groupes_ge from anon, authenticated;
commit;