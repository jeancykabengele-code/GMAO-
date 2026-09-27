from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("profiles", "0002_adopt_business_schema")]

    operations = [
        migrations.AddField(
            model_name="localcredential",
            name="session_version",
            field=models.PositiveIntegerField(default=1),
        ),
    ]
