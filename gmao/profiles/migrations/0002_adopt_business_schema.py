from django.db import migrations


MODEL_NAMES = (
    "DatacenterProblem",
    "FuelDelivery",
    "FuelMonthlySummary",
    "GeneratorRecord",
    "Intervention",
    "LocalCredential",
    "Site",
    "SparePartOperation",
    "UserProfile",
    "Equipment",
    "FuelRecord",
    "GeneratorFuelConsumption",
    "GeneratorMonthlyReading",
    "Notification",
    "PueRecord",
    "Ticket",
)


def _unique_columns(constraints):
    return {
        tuple(definition["columns"])
        for definition in constraints.values()
        if definition.get("unique") and not definition.get("primary_key")
    }


def _validate_existing_table(connection, model):
    table = model._meta.db_table
    with connection.cursor() as cursor:
        columns = {column.name for column in connection.introspection.get_table_description(cursor, table)}
        constraints = connection.introspection.get_constraints(cursor, table)
    expected_columns = {field.column for field in model._meta.local_fields}
    missing_columns = sorted(expected_columns - columns)
    if missing_columns:
        raise RuntimeError(f"{table}: colonnes absentes: {', '.join(missing_columns)}")
    primary_columns = {
        tuple(definition["columns"])
        for definition in constraints.values()
        if definition.get("primary_key")
    }
    expected_primary = (model._meta.pk.column,)
    if expected_primary not in primary_columns:
        raise RuntimeError(f"{table}: clé primaire attendue sur {expected_primary[0]}")
    actual_unique = _unique_columns(constraints)
    for unique in model._meta.unique_together:
        expected = tuple(model._meta.get_field(name).column for name in unique)
        if expected not in actual_unique:
            raise RuntimeError(f"{table}: contrainte unique absente sur {', '.join(expected)}")


def adopt_or_create_tables(apps, schema_editor):
    connection = schema_editor.connection
    models = [apps.get_model("profiles", name) for name in MODEL_NAMES]
    existing = set(connection.introspection.table_names())

    # Validate everything already present before issuing any CREATE TABLE.
    for model in models:
        if model._meta.db_table in existing:
            _validate_existing_table(connection, model)

    for model in models:
        if model._meta.db_table not in existing:
            schema_editor.create_model(model)
            existing.add(model._meta.db_table)


def preserve_tables_on_rollback(apps, schema_editor):
    # The baseline rollback changes only Django's migration state. Physical
    # business tables and their data are intentionally preserved.
    return None


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("profiles", "0001_business_schema_state")]
    operations = [migrations.RunPython(adopt_or_create_tables, preserve_tables_on_rollback)]
