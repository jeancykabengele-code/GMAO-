import datetime

from django.db import migrations, models


def delete_monthly_pue(apps, schema_editor):
    """Le PUE mensuel (énergie IT / énergie totale saisies à la main) est remplacé par un relevé journalier en kW.

    Les anciennes lignes n'ont ni date précise ni puissance par équipement : elles ne peuvent pas être converties.
    """
    apps.get_model("profiles", "PueRecord").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("profiles", "0006_fuel_delivery_month_and_rank")]

    operations = [
        migrations.RunPython(delete_monthly_pue, migrations.RunPython.noop),
        migrations.AlterUniqueTogether(name="puerecord", unique_together=set()),
        migrations.RemoveField(model_name="puerecord", name="mois"),
        migrations.RemoveField(model_name="puerecord", name="energie_it"),
        migrations.RemoveField(model_name="puerecord", name="energie_totale"),
        migrations.AddField(
            model_name="puerecord", name="date_releve",
            field=models.DateField(default=datetime.date(2000, 1, 1)), preserve_default=False,
        ),
        migrations.AddField(
            model_name="puerecord", name="heure_releve",
            field=models.TimeField(default=datetime.time(0, 0)), preserve_default=False,
        ),
        migrations.AddField(model_name="puerecord", name="mesures", field=models.JSONField(default=dict)),
        migrations.AddField(
            model_name="puerecord", name="it_kw",
            field=models.DecimalField(decimal_places=3, default=0, max_digits=14), preserve_default=False,
        ),
        migrations.AddField(
            model_name="puerecord", name="total_kw",
            field=models.DecimalField(decimal_places=3, default=0, max_digits=14), preserve_default=False,
        ),
        migrations.AlterUniqueTogether(name="puerecord", unique_together={("site", "date_releve")}),
    ]
