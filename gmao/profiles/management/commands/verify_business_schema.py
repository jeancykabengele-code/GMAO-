from django.core.management.base import BaseCommand, CommandError
from django.db import connection

MODEL_NAMES = (
    "DatacenterProblem", "FuelDelivery", "FuelMonthlySummary", "GeneratorRecord",
    "Intervention", "LocalCredential", "Site", "SparePartOperation", "UserProfile",
    "Equipment", "FuelRecord", "GeneratorFuelConsumption", "GeneratorMonthlyReading",
    "Notification", "PueRecord", "Ticket",
)


class Command(BaseCommand):
    help = "Vérifie les tables, colonnes, clés primaires et contraintes uniques métier."

    def handle(self, *args, **options):
        existing = set(connection.introspection.table_names())
        errors = []
        for name in MODEL_NAMES:
            model = self._model(name)
            table = model._meta.db_table
            if table not in existing:
                errors.append(f"{table}: table absente")
                continue
            with connection.cursor() as cursor:
                columns = {column.name for column in connection.introspection.get_table_description(cursor, table)}
                constraints = connection.introspection.get_constraints(cursor, table)
            missing = sorted({field.column for field in model._meta.local_fields} - columns)
            if missing:
                errors.append(f"{table}: colonnes absentes: {', '.join(missing)}")
            primary = {
                tuple(item["columns"])
                for item in constraints.values()
                if item.get("primary_key")
            }
            if (model._meta.pk.column,) not in primary:
                errors.append(f"{table}: clé primaire invalide")
            unique_constraints = {
                tuple(item["columns"])
                for item in constraints.values()
                if item.get("unique") and not item.get("primary_key")
            }
            for unique in model._meta.unique_together:
                expected = tuple(model._meta.get_field(field).column for field in unique)
                if expected not in unique_constraints:
                    errors.append(f"{table}: contrainte unique absente sur {', '.join(expected)}")
        if errors:
            raise CommandError("Schéma métier non conforme:\n- " + "\n- ".join(errors))
        self.stdout.write(self.style.SUCCESS(f"Schéma métier conforme: {len(MODEL_NAMES)} tables vérifiées."))

    @staticmethod
    def _model(name):
        from django.apps import apps
        return apps.get_model("profiles", name)
