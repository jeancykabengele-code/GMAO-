from django.db import migrations, models


OFF_GRID_SITES = ("Kikwit", "Mbandaka")


def mark_off_grid_sites(apps, schema_editor):
    Site = apps.get_model("profiles", "Site")
    Site.objects.filter(name__in=OFF_GRID_SITES).update(grid_connected=False)


def restore_off_grid_sites(apps, schema_editor):
    Site = apps.get_model("profiles", "Site")
    Site.objects.filter(name__in=OFF_GRID_SITES).update(grid_connected=True)


def normalize_accounts_and_codes(apps, schema_editor):
    UserProfile = apps.get_model("profiles", "UserProfile")
    Site = apps.get_model("profiles", "Site")
    seen_emails = {}
    for profile in UserProfile.objects.all().order_by("created_at", "email"):
        lowered = str(profile.email or "").strip().lower()
        if not lowered:
            continue
        if lowered in seen_emails and seen_emails[lowered] != profile.pk:
            raise RuntimeError(f"Adresses e-mail en conflit après normalisation : {profile.email}")
        seen_emails[lowered] = profile.pk
        if profile.email != lowered:
            profile.email = lowered
            profile.save(update_fields=["email"])
    seen_codes = {}
    for site in Site.objects.all().order_by("name"):
        code = str(site.code or "").strip().upper()
        if code in seen_codes and seen_codes[code] != site.pk:
            raise RuntimeError(f"Codes de site en conflit après normalisation : {site.code}")
        seen_codes[code] = site.pk
        if site.code != code:
            site.code = code
            site.save(update_fields=["code"])


class Migration(migrations.Migration):

    dependencies = [("profiles", "0004_userprofile_timestamps")]

    operations = [
        migrations.AddField(
            model_name="site",
            name="grid_connected",
            field=models.BooleanField(default=True, db_default=True),
        ),
        migrations.RunPython(mark_off_grid_sites, restore_off_grid_sites),
        migrations.RunPython(normalize_accounts_and_codes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="userprofile",
            name="email",
            field=models.CharField(max_length=320, unique=True),
        ),
        migrations.AlterField(
            model_name="site",
            name="code",
            field=models.CharField(max_length=320, unique=True),
        ),
    ]
