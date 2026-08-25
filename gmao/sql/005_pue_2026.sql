-- PUE 2026 : import des énergies IT et totales, calcul PUE automatique.
begin;

alter table public.gmao_pue
  alter column energie_it type numeric(18,3) using energie_it::numeric(18,3),
  alter column energie_totale type numeric(18,3) using energie_totale::numeric(18,3),
  alter column pue type numeric(8,3) using pue::numeric(8,3);

create or replace function public.gmao_compute_pue()
returns trigger
language plpgsql
as $$
begin
  if new.energie_it is null or new.energie_totale is null
     or new.energie_it <= 0 or new.energie_totale <= 0 then
    raise exception 'Les énergies IT et totale doivent être supérieures à zéro.';
  end if;
  if new.energie_totale < new.energie_it then
    raise exception 'L’énergie totale ne peut pas être inférieure à l’énergie IT.';
  end if;
  new.pue := round(new.energie_totale / new.energie_it, 3);
  return new;
end
$$;

drop trigger if exists trg_gmao_compute_pue on public.gmao_pue;
create trigger trg_gmao_compute_pue
before insert or update of energie_it, energie_totale
on public.gmao_pue
for each row execute function public.gmao_compute_pue();

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
), site_source(site, energies_it, energies_totales) as (
  values
    ('Bukavu', array[26203,22086,24156,23373,24449.219,21866.440]::numeric[], array[46856,37180,43215,37608,40643.889,38508.228]::numeric[]),
    ('Fikin', array[22686,24537,27165,26288,26267.756,26398.117]::numeric[], array[40122,36288,38688,33840,33460.204,34870.182]::numeric[]),
    ('Goma', array[31042,28950,32849,31790,31824.397,30455.605]::numeric[], array[60319,44012,53535,51708,48719.291,44005.342]::numeric[]),
    ('Katanga', array[63254,62140,62378,62221,56238.255,54585.440]::numeric[], array[94060,81189,100269,109707,85694.946,82361.926]::numeric[]),
    ('Kikwit', array[24804.693,22165.031,19525.368,16885.706,15180.248,9737.972]::numeric[], array[35855.302,32319.864,28784.427,25248.989,23064,15477.218]::numeric[]),
    ('Kisangani', array[22526,19205,21287,18782,19195.668,18400.465]::numeric[], array[41283,35045,38798,41823,34816.632,32793.126]::numeric[]),
    ('Matadi', array[15452,15762,15762,15984,19515.427,19065.307]::numeric[], array[23748,26895,27055,26286,28010.005,28182.185]::numeric[]),
    ('Mbandaka', array[28506.097,25641.678,22777.259,19912.840,17465.120,13350.603]::numeric[], array[44434.425,39813.059,35191.692,30570.326,26535.504,20154.503]::numeric[]),
    ('Mbuji mayi', array[37761.900,34942,37761.900,31123,33432.286,27351.382]::numeric[], array[43262,37591,42112,38650,52275.533,37911.128]::numeric[]),
    ('MTC', array[19412,17521,19521,18891,20617.034,18019.159]::numeric[], array[29018,26018,29256,28057,31195.752,27485.568]::numeric[]),
    ('New MTC', array[146359,132955,155466,157428,158364.260,155079.161]::numeric[], array[200024,188832,222828,227052,226969.185,223751.478]::numeric[]),
    ('Pigeon', array[217766,196700,217775,210150,211910.070,219984.309]::numeric[], array[342384,300384,332138,324000,326032.542,330016.370]::numeric[]),
    ('Utex', array[74390,68201,75390,72958,82036.223,81560.405]::numeric[], array[133653,122260,133453,133453,139511.372,140745.063]::numeric[])
), expanded as (
  select site, format('2026-%s', lpad(month_index::text, 2, '0')) as mois,
         energies_it[month_index] as energie_it,
         energies_totales[month_index] as energie_totale
  from site_source cross join generate_series(1, 6) as month_index
)
insert into public.gmao_pue (
  site, mois, energie_it, energie_totale, pue, created_by
)
select expanded.site, expanded.mois, expanded.energie_it, expanded.energie_totale, 1, actor.id
from expanded cross join actor
on conflict (site, mois) do update set
  energie_it = excluded.energie_it,
  energie_totale = excluded.energie_totale,
  updated_by = excluded.created_by,
  updated_at = now();

alter table public.gmao_pue replica identity full;
alter table public.gmao_pue enable row level security;
grant select on public.gmao_pue to authenticated;

drop policy if exists gmao_pue_select_realtime on public.gmao_pue;
create policy gmao_pue_select_realtime on public.gmao_pue
for select to authenticated
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
         and tablename = 'gmao_pue'
     ) then
    alter publication supabase_realtime add table public.gmao_pue;
  end if;
end
$$;

commit;

select mois, count(*) as sites, round(avg(pue), 3) as pue_moyen
from public.gmao_pue
where mois between '2026-01' and '2026-06'
group by mois
order by mois;