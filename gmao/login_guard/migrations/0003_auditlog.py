from django.db import migrations, models


def create_immutability_triggers(apps, schema_editor):
    vendor = schema_editor.connection.vendor
    statements = []
    if vendor == "mysql":
        statements = [
            """CREATE TRIGGER gmao_audit_log_no_update BEFORE UPDATE ON audit_log
               FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only'""",
            """CREATE TRIGGER gmao_audit_log_no_delete BEFORE DELETE ON audit_log
               FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only'""",
        ]
    elif vendor == "sqlite":
        statements = [
            """CREATE TRIGGER gmao_audit_log_no_update BEFORE UPDATE ON audit_log
               BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END""",
            """CREATE TRIGGER gmao_audit_log_no_delete BEFORE DELETE ON audit_log
               BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END""",
        ]
    for statement in statements:
        schema_editor.execute(statement)


def drop_immutability_triggers(apps, schema_editor):
    vendor = schema_editor.connection.vendor
    if vendor in {"mysql", "sqlite"}:
        schema_editor.execute("DROP TRIGGER IF EXISTS gmao_audit_log_no_update")
        schema_editor.execute("DROP TRIGGER IF EXISTS gmao_audit_log_no_delete")


class Migration(migrations.Migration):
    dependencies = [("login_guard", "0002_passwordhistory")]
    operations = [
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("actor_id", models.UUIDField(blank=True, db_index=True, null=True)),
                ("actor_email", models.CharField(blank=True, max_length=254)),
                ("action", models.CharField(db_index=True, max_length=64)),
                ("target_type", models.CharField(db_index=True, max_length=64)),
                ("target_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("result", models.CharField(db_index=True, max_length=16)),
                ("ip_address", models.CharField(max_length=64)),
                ("details", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={"db_table": "audit_log", "ordering": ("-created_at", "-id")},
        ),
        migrations.RunPython(create_immutability_triggers, drop_immutability_triggers),
    ]
