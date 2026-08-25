-- Fuel GE 2026 : synthèse globale, détail par site et calculs automatiques.
begin;

alter table public.gmao_fuel_ge
  alter column stock_initial drop not null,
  alter column entree drop not null,
  alter column stock_final drop not null,
  alter column litres_heure drop not null,
  alter column snel_kwh drop not null,
  alter column sortie type numeric(16,3) using sortie::numeric(16,3),
  alter column litres_heure type numeric(14,3) using litres_heure::numeric(14,3);

alter table public.gmao_fuel_ge drop column if exists etat;

create table if not exists public.gmao_fuel_monthly_summary (
  id uuid primary key default gen_random_uuid(),
  site text not null default 'GLOBAL',
  periode text not null,
  stock_initial numeric(16,3) not null,
  entree numeric(16,3) not null,
  sortie numeric(16,3) not null,
  stock_final numeric(16,3) not null,
  heures_ge numeric(14,2) not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id),
  updated_at timestamptz not null default now(),
  unique (site, periode)
);

create or replace function public.gmao_compute_fuel_metrics()
returns trigger
language plpgsql
as $$
declare
  annee integer;
  mois integer;
  heures_mois numeric;
begin
  if new.periode !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'La période doit être au format AAAA-MM.';
  end if;
  if new.sortie is null or new.heures_ge is null or new.sortie < 0 or new.heures_ge < 0 then
    raise exception 'La consommation et les heures GE doivent être renseignées et positives.';
  end if;

  annee := split_part(new.periode, '-', 1)::integer;
  mois := split_part(new.periode, '-', 2)::integer;
  heures_mois := extract(day from (date_trunc('month', make_date(annee, mois, 1)) + interval '1 month - 1 day')) * 24;

  if new.heures_ge > 0 then
    new.litres_heure := round(new.sortie / new.heures_ge, 3);
  elsif new.sortie = 0 then
    new.litres_heure := 0;
  else
    new.litres_heure := null;
  end if;

  if new.site in ('Kikwit', 'Mbandaka') then
    new.snel_kwh := null;
    new.disponibilite_grid := 0;
  else
    new.disponibilite_grid := round(greatest(0, least(100, (1 - new.heures_ge / heures_mois) * 100)), 2);
  end if;
  return new;
end
$$;

drop trigger if exists trg_gmao_compute_fuel_metrics on public.gmao_fuel_ge;
create trigger trg_gmao_compute_fuel_metrics
before insert or update of site, periode, sortie, heures_ge, snel_kwh
on public.gmao_fuel_ge
for each row execute function public.gmao_compute_fuel_metrics();

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
), source(periode, stock_initial, entree, sortie, stock_final, heures_ge) as (
  values
    ('2026-01', 124012.029, 29363.873, 40693.213, 112682.689, 2718.00),
    ('2026-02', 112680.689, 45624.656, 45264.131, 113041.214, 2624.28),
    ('2026-03', 116016.614, 37439.370, 37349.182, 116106.802, 2781.24),
    ('2026-04', 116106.802, 39176.648, 39569.826, 115713.624, 2840.13),
    ('2026-05', 114811.246, 32267.767, 37217.878, 109861.135, 2746.52),
    ('2026-06', 110984.135, 34041.305, 32172.115, 112853.325, 1741.30)
)
insert into public.gmao_fuel_monthly_summary (
  site, periode, stock_initial, entree, sortie, stock_final, heures_ge, created_by
)
select 'GLOBAL', source.periode, source.stock_initial, source.entree, source.sortie,
       source.stock_final, source.heures_ge, actor.id
from source cross join actor
on conflict (site, periode) do update set
  stock_initial = excluded.stock_initial,
  entree = excluded.entree,
  sortie = excluded.sortie,
  stock_final = excluded.stock_final,
  heures_ge = excluded.heures_ge,
  updated_by = excluded.created_by,
  updated_at = now();

with actor as (
  select id from public.user_profiles
  where active = true and role in ('manager', 'charge_operations')
  order by case role when 'manager' then 0 else 1 end, created_at
  limit 1
), site_source(site, consommations, heures, snel) as (
  values
    ('Bukavu', array[222.650,400.880,381.170,547.220,178.960,416.170]::numeric[], array[12.20,18.80,24.50,22.50,9.30,20.90]::numeric[], array[46306,36260,42115,36505,40213,38500]::numeric[]),
    ('Fikin', array[3968,3626,7189.360,8282,8619,1477]::numeric[], array[242,257,510,584,590,101]::numeric[], array[29501,25667,17873,10950,14770,34900]::numeric[]),
    ('Goma', array[277.713,1047.905,721.036,872.371,843.355,2302.080]::numeric[], array[16,55.23,38.07,45.67,47.97,121.61]::numeric[], array[58801.7,40837,51806,47274,47445.4,33865]::numeric[]),
    ('Katanga', array[3611.180,976,4277.660,1472.900,2536.640,1165.280]::numeric[], array[119.30,28,117.60,42.30,63.70,34.10]::numeric[], array[89170.6,68482,80400,88033,80414.3,87000]::numeric[]),
    ('Kikwit', array[5376.604,5146.500,5869.171,5665.641,5860.680,5524.629]::numeric[], array[717.03,705.46,743.73,719.40,743.90,99.73]::numeric[], array[null,null,null,null,null,null]::numeric[]),
    ('Kisangani', array[9201,8339,3652,5477,7280,8159]::numeric[], array[412.04,369.28,219.94,380.74,324.66,370.31]::numeric[], array[24709,22055,38400,25800,29000,15850]::numeric[]),
    ('MTC', array[87,1767,1968,970.500,0,113.500]::numeric[], array[4,77,71,37,0,4]::numeric[], array[29018,18658,28549,27611,31200,27500]::numeric[]),
    ('Matadi', array[591.272,484.604,449.859,532.438,436.725,293.332]::numeric[], array[56.12,41.17,42.82,44.44,43,25.91]::numeric[], array[21907,19535,25638,24808,24808,27330]::numeric[]),
    ('Mbandaka', array[7875.400,8660.400,7208.200,8745.400,5582.600,6965.800]::numeric[], array[744.67,671.99,791.84,716.46,740.80,724.53]::numeric[], array[null,null,null,null,null,null]::numeric[]),
    ('Mbuji mayi', array[4747.394,4664.042,3307.726,3595.356,3196.918,4017.324]::numeric[], array[297.06,315.86,191.01,198.98,183.19,225.69]::numeric[], array[36352,29742,39582,35437,38068,35209]::numeric[]),
    ('New MTC', array[111,3701,440,147,0,349]::numeric[], array[1.98,46.56,5.94,2.23,0,3.18]::numeric[], array[199770,179172,221037,222170,227000,224000]::numeric[]),
    ('Pigeon', array[4461,5795.800,1472,2967,2533,1389]::numeric[], array[89,32,15,38,0,9.24]::numeric[], array[313515,290957,328191,309963,320544,327074]::numeric[]),
    ('Utex', array[163,655,413,295,150,0]::numeric[], array[6.60,5.93,9.79,8.41,0,1.10]::numeric[], array[141115.5,127715.5,151005.5,132587,150378.5,142000]::numeric[])
), expanded as (
  select site, format('2026-%s', lpad(month_index::text, 2, '0')) as periode,
         consommations[month_index] as sortie, heures[month_index] as heures_ge, snel[month_index] as snel_kwh
  from site_source cross join generate_series(1, 6) as month_index
)
insert into public.gmao_fuel_ge (
  site, periode, stock_initial, entree, sortie, stock_final, heures_ge,
  litres_heure, snel_kwh, disponibilite_grid, created_by
)
select expanded.site, expanded.periode, null, null, expanded.sortie, null,
       expanded.heures_ge, null, expanded.snel_kwh, 0, actor.id
from expanded cross join actor
on conflict (site, periode) do update set
  sortie = excluded.sortie,
  heures_ge = excluded.heures_ge,
  snel_kwh = excluded.snel_kwh,
  updated_by = excluded.created_by,
  updated_at = now();

alter table public.gmao_fuel_ge replica identity full;
alter table public.gmao_fuel_monthly_summary replica identity full;
alter table public.gmao_fuel_ge enable row level security;
alter table public.gmao_fuel_monthly_summary enable row level security;
grant select on public.gmao_fuel_ge, public.gmao_fuel_monthly_summary to authenticated;

drop policy if exists gmao_fuel_select_realtime on public.gmao_fuel_ge;
create policy gmao_fuel_select_realtime on public.gmao_fuel_ge
for select to authenticated
using (
  public.current_gmao_role() in ('manager', 'charge_operations')
  or site = public.current_gmao_site()
);

drop policy if exists gmao_fuel_summary_select on public.gmao_fuel_monthly_summary;
create policy gmao_fuel_summary_select on public.gmao_fuel_monthly_summary
for select to authenticated
using (public.current_gmao_role() in ('manager', 'charge_operations'));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'gmao_fuel_ge'
    ) then
      alter publication supabase_realtime add table public.gmao_fuel_ge;
    end if;
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'gmao_fuel_monthly_summary'
    ) then
      alter publication supabase_realtime add table public.gmao_fuel_monthly_summary;
    end if;
  end if;
end
$$;

commit;

select periode, stock_final, sortie, heures_ge
from public.gmao_fuel_monthly_summary
order by periode;

select periode, count(*) as sites, round(avg(disponibilite_grid), 2) as disponibilite_grid_moyenne,
       round(sum(sortie), 3) as consommation_totale
from public.gmao_fuel_ge
where periode between '2026-01' and '2026-06'
group by periode
order by periode;