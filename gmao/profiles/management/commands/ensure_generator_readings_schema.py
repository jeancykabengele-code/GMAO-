from django.core.management.base import BaseCommand
from django.db import connection


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
        self.stdout.write(self.style.SUCCESS("Schéma des relevés RH mensuels prêt."))