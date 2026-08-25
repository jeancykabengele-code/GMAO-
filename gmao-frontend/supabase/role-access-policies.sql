-- Politique d'accès GMAO ORDC
-- À exécuter dans Supabase SQL Editor après vérification des profils.

begin;

alter table public.user_profiles enable row level security;

-- Empêche l'enregistrement d'un rôle inconnu.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_role_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_role_check
      check (role in ('manager', 'charge_operations', 'chef_site'));
  end if;
end $$;

-- Fonctions SECURITY DEFINER pour éviter la récursion RLS sur user_profiles.
create or replace function public.current_gmao_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_profiles
  where id = auth.uid() and active = true
  limit 1
$$;

create or replace function public.current_gmao_site()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select site
  from public.user_profiles
  where id = auth.uid() and active = true
  limit 1
$$;

revoke all on function public.current_gmao_role() from public;
revoke all on function public.current_gmao_site() from public;
grant execute on function public.current_gmao_role() to authenticated;
grant execute on function public.current_gmao_site() to authenticated;

-- Chaque utilisateur actif lit son profil. Les rôles globaux peuvent lire tous les profils.
drop policy if exists user_profiles_select_scope on public.user_profiles;
create policy user_profiles_select_scope
on public.user_profiles
for select
to authenticated
using (
  active = true
  and (
    id = auth.uid()
    or public.current_gmao_role() in ('manager', 'charge_operations')
  )
);

-- Aucun INSERT, UPDATE ou DELETE de profil n'est accordé depuis le navigateur.
-- L'administration des profils devra passer par Spring Boot avec une clé serveur.

commit;

-- Modèle à appliquer plus tard à CHAQUE table métier possédant une colonne site :
--
-- SELECT : rôles globaux = tous les sites ; chef_site = son site uniquement.
-- using (
--   public.current_gmao_role() in ('manager', 'charge_operations')
--   or site = public.current_gmao_site()
-- )
--
-- INSERT : tous les rôles actifs peuvent ajouter ; chef_site uniquement dans son site.
-- with check (
--   public.current_gmao_role() in ('manager', 'charge_operations')
--   or (
--     public.current_gmao_role() = 'chef_site'
--     and site = public.current_gmao_site()
--   )
-- )
--
-- UPDATE : manager et charge_operations uniquement.
-- using (public.current_gmao_role() in ('manager', 'charge_operations'))
-- with check (public.current_gmao_role() in ('manager', 'charge_operations'))
--
-- DELETE : aucune politique, donc suppression refusée à tous les rôles.