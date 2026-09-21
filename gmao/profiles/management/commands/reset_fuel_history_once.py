from django.core.management.base import BaseCommand
from django.db import connection, transaction


RESET_TASK = "reset_fuel_history_2026_v1"
TABLES_TO_CLEAR = (
    "gmao_fuel_monthly_summary",
    "gmao_fuel_ge",
    "gmao_consommations_groupes_ge",
    "gmao_fuel_ravitaillements",
)


class Command(BaseCommand):
    help = (
        "Réinitialise une seule fois les historiques Fuel-GE, Consommation par GE "
        "et Ravitaillement Fuel de production."
    )

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            self.stdout.write(
                self.style.WARNING("Réinitialisation ignorée hors de la base PostgreSQL de production.")
            )
            return

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    create table if not exists public.gmao_system_tasks (
                        task_key text primary key,
                        executed_at timestamptz not null default now()
                    )
                    """
                )
                cursor.execute(
                    "select 1 from public.gmao_system_tasks where task_key = %s for update",
                    [RESET_TASK],
                )
                if cursor.fetchone():
                    self.stdout.write("Réinitialisation Fuel déjà exécutée.")
                    return

                deleted = {}
                for table in TABLES_TO_CLEAR:
                    cursor.execute(f"delete from public.{table}")
                    deleted[table] = cursor.rowcount

                cursor.execute(
                    "insert into public.gmao_system_tasks (task_key) values (%s)",
                    [RESET_TASK],
                )

        self.stdout.write(
            self.style.SUCCESS(
                "Réinitialisation Fuel terminée : "
                + ", ".join(f"{table}={count}" for table, count in deleted.items())
            )
        )
