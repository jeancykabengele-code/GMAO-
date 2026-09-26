from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("login_guard", "0001_initial")]
    operations = [
        migrations.CreateModel(
            name="PasswordHistory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("profile_id", models.UUIDField(db_index=True)),
                ("password_hash", models.CharField(max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "gmao_password_history",
                "ordering": ("-created_at", "-id"),
            },
        ),
    ]
