from django.core.management.base import BaseCommand
from django.db import connection, transaction


class Command(BaseCommand):
    help = "Crée la table interne des relevés RH mensuels."

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            self.stdout.write("Schéma RH ignoré hors PostgreSQL.")
            return
        with connection.cursor() as cursor:
            cursor.execute("""
                create table if not exists public.gmao_releves_rh_ge (
                    id uuid primary key default gen_random_uuid(), site text not null references public.sites(name),
                    periode text not null check (periode ~ '^\\d{4}-(0[1-9]|1[0-2])$'), groupe_code text not null,
                    rh_actuel numeric(14,2) not null check (rh_actuel >= 0), commentaires text not null default '',
                    created_by uuid not null references public.user_profiles(id), created_at timestamptz not null default now(),
                    updated_by uuid references public.user_profiles(id), updated_at timestamptz not null default now(),
                    unique (site, periode, groupe_code)
                )
            """)
            cursor.execute("create index if not exists gmao_releves_rh_ge_lookup_idx on public.gmao_releves_rh_ge (site, groupe_code, periode desc)")
            cursor.execute("""
                create table if not exists public.gmao_system_tasks (
                    task_key text primary key,
                    executed_at timestamptz not null default now()
                )
            """)
            cursor.execute(
                "select 1 from public.gmao_system_tasks where task_key = %s",
                ["cleanup_duplicate_generators_2026_v1"],
            )
            if not cursor.fetchone():
                cursor.execute("""
                    delete from public.gmao_groupes_electrogenes as duplicate
                    using (
                        select id, row_number() over (
                            partition by site, code
                            order by created_at desc, id desc
                        ) as row_number
                        from public.gmao_groupes_electrogenes
                    ) as ranked
                    where duplicate.id = ranked.id and ranked.row_number > 1
                """)
                deleted = cursor.rowcount
                cursor.execute(
                    "insert into public.gmao_system_tasks (task_key) values (%s)",
                    ["cleanup_duplicate_generators_2026_v1"],
                )
                self.stdout.write(self.style.WARNING(f"Doublons GE supprimés : {deleted}."))
            cursor.execute("""
                create unique index if not exists gmao_groupes_electrogenes_site_code_unique
                on public.gmao_groupes_electrogenes (site, code)
            """)
        self.stdout.write(self.style.SUCCESS("Schéma des relevés RH mensuels prêt."))