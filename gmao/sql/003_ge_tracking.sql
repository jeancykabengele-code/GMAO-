-- Suivi des compteurs GE, calcul PM automatique et synchronisation Supabase Realtime.
begin;

alter table public.gmao_groupes_electrogenes
  add column if not exists code text,
  add column if not exists rh_actuel numeric(14,2),
  add column if not exists rh_derniere_pm numeric(14,2),
  add column if not exists retard_signale boolean not null default false;

alter table public.gmao_groupes_electrogenes
  alter column date_mise_en_service drop not null,
  alter column date_derniere_pm drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gmao_groupes_site_code_key'
      and conrelid = 'public.gmao_groupes_electrogenes'::regclass
  ) then
    alter table public.gmao_groupes_electrogenes
      add constraint gmao_groupes_site_code_key unique (site, code);
  end if;
end
$$;

create or replace function public.gmao_compute_ge_pm()
returns trigger
language plpgsql
as $$
declare
  heures_depuis_pm numeric(14,2);
begin
  if new.rh_actuel is null or new.rh_derniere_pm is null then
    raise exception 'Les compteurs RH actuel et RH dernière PM sont obligatoires.';
  end if;
  if new.rh_actuel < new.rh_derniere_pm then
    raise exception 'Le compteur RH actuel ne peut pas être inférieur au compteur de la dernière PM.';
  end if;
  heures_depuis_pm := new.rh_actuel - new.rh_derniere_pm;
  new.rh_depuis_derniere_pm := heures_depuis_pm;
  new.rh_prochaine_pm := new.rh_derniere_pm + 250;
  if heures_depuis_pm >= 250 then
    new.etat := 'PmDepassee';
  elsif heures_depuis_pm >= 225 then
    new.etat := 'PmUrgente';
  elsif heures_depuis_pm >= 175 or new.retard_signale then
    new.etat := 'ASurveiller';
  else
    new.etat := 'Normal';
  end if;
  return new;
end
$$;

drop trigger if exists trg_gmao_compute_ge_pm on public.gmao_groupes_electrogenes;
create trigger trg_gmao_compute_ge_pm
before insert or update of rh_actuel, rh_derniere_pm, retard_signale
on public.gmao_groupes_electrogenes
for each row execute function public.gmao_compute_ge_pm();

do $$
begin
  if not exists (
    select 1 from public.user_profiles
    where active = true and role in ('manager', 'charge_operations')
  ) then
    raise exception 'Aucun profil global actif disponible pour created_by.';
  end if;
end
$$;

with actor as (
  select id from public.user_profiles
  where active = true and role in ('manager', 'charge_operations')
  order by case role when 'manager' then 0 else 1 end, created_at
  limit 1
), source(site, code, type_ge, rh_actuel, rh_derniere_pm, retard_signale, commentaires) as (
  values
    ('New MTC', 'DC-NMTC-GE-001', 'PRAMAC 1250 KVA G1', 197.00, 166.50, false, ''),
    ('New MTC', 'DC-NMTC-GE-002', 'PRAMAC 1250 KVA G2', 225.00, 177.32, false, ''),
    ('Pigeon', 'DC-PIG-GE-001', 'FG Wilson 1250 KVA', 245.00, 238.09, false, ''),
    ('Pigeon', 'DC-PIG-GE-003', 'TEKSAN 510 KVA', 1233.00, 1067.00, false, ''),
    ('Pigeon', 'DC-PIG-GE-002', 'Caterpillar 500 KVA', 1249.00, 1228.40, false, ''),
    ('Utex', 'DC-UTX-GE-001', 'Caterpillar 810 KVA', 1548.00, 1525.00, false, 'État PM fourni comme Normal* dans la source.'),
    ('Utex', 'DC-UTX-GE-003', 'GESAN 800 KVA', 1633.00, 1633.00, false, 'État PM fourni comme Normal* dans la source.'),
    ('Utex', 'DC-UTX-GE-002', 'FG Wilson 900 KVA', 195.00, 149.00, false, ''),
    ('MTC', 'DC-MTC-GE-002', 'GENELEC 400 KVA', 3902.00, 3885.00, false, ''),
    ('MTC', 'DC-MTC-GE-001', 'Perkins 380 KVA', 4959.00, 4820.00, false, ''),
    ('Fikin', 'DC-FIK-GE-001', 'VISA 150 KVA G1', 8906.00, 8733.52, false, ''),
    ('Fikin', 'DC-FIK-GE-002', 'VISA 150 KVA G2', 6762.00, 6748.16, false, ''),
    ('Fikin', 'DC-FIK-GE-003', 'LINZ 80 KVA', 444.00, 273.00, false, ''),
    ('Bukavu', 'DC-BKV-GE-001', 'VISA 250 KVA G1', 217.00, 105.90, false, ''),
    ('Bukavu', 'DC-BKV-GE-002', 'VISA 250 KVA G2', 338.00, 242.30, false, ''),
    ('Goma', 'DC-GOM-GE-001', 'LINZ Electric 150 KVA G1', 14186.41, 14134.00, false, ''),
    ('Goma', 'DC-GOM-GE-002', 'LINZ Electric 150 KVA G2', 12271.28, 12212.00, false, ''),
    ('Matadi', 'DC-MAT-GE-001', 'VISA 150 KVA G1', 820.00, 722.39, false, ''),
    ('Matadi', 'DC-MAT-GE-002', 'VISA 150 KVA G2', 828.00, 724.27, false, ''),
    ('Kisangani', 'DC-KIS-GE-001', 'VISA 200 KVA G1', 13082.00, 13039.04, false, ''),
    ('Kisangani', 'DC-KIS-GE-002', 'VISA 200 KVA G2', 15248.00, 15164.59, true, 'Retard signalé dans la source.'),
    ('Mbuji mayi', 'DC-MBM-GE-001', 'VISA 150 KVA G1', 5617.00, 5523.00, false, ''),
    ('Mbuji mayi', 'DC-MBM-GE-002', 'VISA 150 KVA G2', 5543.00, 5491.25, false, ''),
    ('Kikwit', 'DC-KIK-GE-001', 'VISA 150 KVA G1', 13959.00, 13933.00, false, ''),
    ('Kikwit', 'DC-KIK-GE-002', 'VISA 150 KVA G2', 13330.00, 13055.59, false, ''),
    ('Mbandaka', 'DC-MBD-GE-001', 'VISA 150 KVA G1', 16024.00, 15996.00, true, 'Retard signalé dans la source.'),
    ('Mbandaka', 'DC-MBD-GE-002', 'VISA 150 KVA G2', 16129.00, 16061.00, true, 'Retard signalé dans la source.'),
    ('Katanga', 'DC-KAT-GE-001', 'FG Wilson 250 KVA G1', 352.20, 342.20, false, ''),
    ('Katanga', 'DC-KAT-GE-002', 'FG Wilson 250 KVA G2', 322.80, 318.30, false, '')
)
insert into public.gmao_groupes_electrogenes (
  site, code, type_ge, mois_releve, date_mise_en_service, date_derniere_pm,
  rh_actuel, rh_derniere_pm, rh_depuis_derniere_pm, rh_prochaine_pm,
  retard_signale, etat, commentaires, created_by
)
select source.site, source.code, source.type_ge, '2026-08', null::date, null::date,
  source.rh_actuel, source.rh_derniere_pm, 0, 0, source.retard_signale,
  'Normal', source.commentaires, actor.id
from source cross join actor
on conflict (site, code) do update set
  type_ge = excluded.type_ge,
  rh_actuel = excluded.rh_actuel,
  rh_derniere_pm = excluded.rh_derniere_pm,
  retard_signale = excluded.retard_signale,
  commentaires = excluded.commentaires,
  updated_by = excluded.created_by,
  updated_at = now();

alter table public.gmao_groupes_electrogenes replica identity full;
alter table public.gmao_groupes_electrogenes enable row level security;
grant select on public.gmao_groupes_electrogenes to authenticated;

drop policy if exists gmao_groupes_select_realtime on public.gmao_groupes_electrogenes;
create policy gmao_groupes_select_realtime
on public.gmao_groupes_electrogenes
for select
to authenticated
using (
  public.current_gmao_role() in ('manager', 'charge_operations')
  or site = public.current_gmao_site()
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'gmao_groupes_electrogenes'
     ) then
    alter publication supabase_realtime add table public.gmao_groupes_electrogenes;
  end if;
end
$$;

commit;

select etat, count(*)
from public.gmao_groupes_electrogenes
where code is not null
group by etat
order by etat;