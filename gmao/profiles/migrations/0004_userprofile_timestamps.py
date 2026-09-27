from django.db import migrations, models


def ensure_updated_at_column(apps, schema_editor):
    model = apps.get_model("profiles", "UserProfile")
    table = model._meta.db_table
    with schema_editor.connection.cursor() as cursor:
        columns = {
            column.name
            for column in schema_editor.connection.introspection.get_table_description(cursor, table)
        }
    if "updated_at" not in columns:
        schema_editor.add_field(model, model._meta.get_field("updated_at"))


def preserve_timestamp_columns(apps, schema_editor):
    # Rollback only changes Django's state. The legacy timestamp columns and
    # their data remain intact.
    return None


class Migration(migrations.Migration):
    dependencies = [("profiles", "0003_localcredential_session_version")]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name="userprofile",
                    name="created_at",
                    field=models.DateTimeField(auto_now_add=True),
                ),
                migrations.AddField(
                    model_name="userprofile",
                    name="updated_at",
                    field=models.DateTimeField(auto_now=True),
                ),
            ],
        ),
        migrations.RunPython(ensure_updated_at_column, preserve_timestamp_columns),
    ]
