from django.db import migrations


class Migration(migrations.Migration):
    """Le relevé PUE n'est plus limité à un par jour : la contrainte unique (site, date) est supprimée."""

    dependencies = [("profiles", "0007_pue_daily_readings")]

    operations = [
        migrations.AlterUniqueTogether(name="puerecord", unique_together=set()),
    ]
