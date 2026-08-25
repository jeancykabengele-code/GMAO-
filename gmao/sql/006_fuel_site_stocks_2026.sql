begin;

create temporary table fuel_site_stocks_import (
  site text not null,
  periode text not null,
  stock_initial numeric(16,3) not null,
  stock_final numeric(16,3) not null,
  primary key (site, periode)
) on commit drop;

with source(site, stock_initials, stock_finals) as (
  values
    ('Bukavu', array[4820.700,4598.050,4197.170,3816,6269.780,6090.820]::numeric[], array[4598.050,4197.170,3816,6269.780,6090.820,5674.650]::numeric[]),
    ('Fikin', array[5504,4654,5527,4830,2999,2880]::numeric[], array[4656,5527,4830,2999,2880,2903]::numeric[]),
    ('Goma', array[4975.064,4697.351,6229.446,6409.290,5536.919,4693.564]::numeric[], array[4697.351,6229.446,6409.290,5536.919,4693.564,5391.484]::numeric[]),
    ('Katanga', array[3357.180,3746,4270,2262.340,3489.440,2252.800]::numeric[], array[3746,4270,2262.340,3489.440,2252.800,2387.520]::numeric[]),
    ('Kikwit', array[3391.101,523.980,872.181,1004.640,688.251,895.338]::numeric[], array[523.980,872.181,1004.640,1340.629,895.338,1323.777]::numeric[]),
    ('Kisangani', array[3592,3391,4052,4700,8223,5943]::numeric[], array[3391,4052,4700,8223,5943,6840]::numeric[]),
    ('Matadi', array[3090.320,2933.438,3148.989,2699.130,2467.210,2030.485]::numeric[], array[2933.438,3148.989,2699.130,2467.210,2030.485,2650.390]::numeric[]),
    ('Mbandaka', array[2734.400,1059,1374,2140.300,1119.400,3536.800]::numeric[], array[1059,398.600,2140.300,1369.400,3536.800,4471]::numeric[]),
    ('Mbuji mayi', array[2545.264,1897.870,3175.828,3868.102,2972.746,3175.828]::numeric[], array[1897.870,3175.828,3868.102,2972.746,3175.828,3577.504]::numeric[]),
    ('MTC', array[2875,2788,3021,6553,5582.500,5582.500]::numeric[], array[2788,1021,6553,5582.500,5582.500,5469]::numeric[]),
    ('New MTC', array[18297,18186,14485,14045,13898,13898]::numeric[], array[18186,14485,14045,13898,13898,13549]::numeric[]),
    ('Pigeon', array[28787,24326,26439,24967,22000,20590]::numeric[], array[24326,26439,24967,22000,19467,19201]::numeric[]),
    ('Utex', array[40043,39880,39225,38812,39565,39415]::numeric[], array[39880,39225,38812,39565,39415,39415]::numeric[])
)
insert into fuel_site_stocks_import(site, periode, stock_initial, stock_final)
select source.site,
       format('2026-%s', lpad(month_index::text, 2, '0')),
       source.stock_initials[month_index],
       source.stock_finals[month_index]
from source
cross join generate_series(1, 6) as month_index;

do $$
declare
  imported_count integer;
  missing_count integer;
begin
  select count(*) into imported_count from fuel_site_stocks_import;
  if imported_count <> 78 then
    raise exception 'Import Fuel invalide : 78 lignes attendues, % trouvées.', imported_count;
  end if;

  select count(*) into missing_count
  from fuel_site_stocks_import source
  where not exists (
    select 1 from public.gmao_fuel_ge target
    where target.site = source.site and target.periode = source.periode
  );
  if missing_count <> 0 then
    raise exception 'Import Fuel impossible : % lignes site/mois sont absentes de gmao_fuel_ge.', missing_count;
  end if;

  if exists (
    select 1
    from (
      select periode, round(sum(stock_initial), 3) as stock_initial, round(sum(stock_final), 3) as stock_final
      from fuel_site_stocks_import
      group by periode
    ) imported
    join public.gmao_fuel_monthly_summary summary using (periode)
    where imported.stock_initial <> summary.stock_initial
       or imported.stock_final <> summary.stock_final
  ) then
    raise exception 'Les totaux mensuels des stocks par site ne correspondent pas à la synthèse globale.';
  end if;
end
$$;

update public.gmao_fuel_ge target
set stock_initial = source.stock_initial,
    stock_final = source.stock_final,
    updated_at = now()
from fuel_site_stocks_import source
where target.site = source.site
  and target.periode = source.periode;

commit;

select periode,
       count(*) as sites,
       round(sum(stock_initial), 3) as stock_initial_total,
       round(sum(stock_final), 3) as stock_final_total
from public.gmao_fuel_ge
where periode between '2026-01' and '2026-06'
group by periode
order by periode;
