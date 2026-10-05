from django.db import migrations, models


def fill_period_and_rank(apps, schema_editor):
    """Déduit le mois et le rang (ordre des dates dans le mois) des ravitaillements existants."""
    FuelDelivery = apps.get_model("profiles", "FuelDelivery")
    counters = {}
    for delivery in FuelDelivery.objects.all().order_by("site", "date_ravitaillement", "created_at", "id"):
        periode = delivery.date_ravitaillement.strftime("%Y-%m")
        counters[(delivery.site, periode)] = counters.get((delivery.site, periode), 0) + 1
        delivery.periode = periode
        delivery.rang = counters[(delivery.site, periode)]
        delivery.save(update_fields=["periode", "rang"])


class Migration(migrations.Migration):
    dependencies = [("profiles", "0005_site_grid_and_unique_accounts")]

    operations = [
        migrations.AddField(
            model_name="fueldelivery", name="periode",
            field=models.CharField(default="", max_length=7), preserve_default=False,
        ),
        migrations.AddField(
            model_name="fueldelivery", name="rang",
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AlterField(
            model_name="fueldelivery", name="date_ravitaillement",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.RunPython(fill_period_and_rank, migrations.RunPython.noop),
        migrations.AlterUniqueTogether(name="fueldelivery", unique_together={("site", "periode", "rang")}),
    ]
