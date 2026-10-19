from django.db import migrations, models


class Migration(migrations.Migration):
    """Scénario de saisie du relevé PUE : S1 (TGBT + IT, hors IT déduit) ou S2 (IT + hors IT, total déduit)."""

    dependencies = [("profiles", "0008_pue_several_readings_per_day")]

    operations = [
        migrations.AddField(
            model_name="puerecord", name="scenario",
            field=models.CharField(blank=True, default="", max_length=2),
        ),
    ]
