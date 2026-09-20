import csv
import uuid
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import DatabaseError

from profiles.models import GeneratorFuelConsumption, GeneratorRecord, UserProfile
from profiles.permissions import GLOBAL_ROLES


SOURCE_FILE = Path(__file__).resolve().parents[3] / "data" / "consommations_groupes_ge_2026.csv"
IMPORT_COMMENT = ""


class Command(BaseCommand):
    help = (
        "Importe les consommations calculées par groupe GE de janvier à août 2026. "
        "Les lignes existantes et les valeurs source incomplètes ne sont jamais modifiées."
    )

    def handle(self, *args, **options):
        if not SOURCE_FILE.exists():
            self.stdout.write(self.style.WARNING(f"Import ignoré : fichier absent ({SOURCE_FILE})."))
            return

        try:
            actor = (
                UserProfile.objects.filter(active=True, role__in=GLOBAL_ROLES)
                .order_by("created_at", "email")
                .first()
            )
        except DatabaseError as error:
            self.stdout.write(self.style.WARNING(f"Import GE ignoré : base indisponible ({error})."))
            return

        if actor is None:
            self.stdout.write(self.style.WARNING("Import GE ignoré : aucun profil global actif."))
            return

        removed_comments = GeneratorFuelConsumption.objects.filter(
            commentaires="Import Excel « Consommation par site et par GE 2026 »."
        ).update(commentaires="")
        known_codes = set(GeneratorRecord.objects.values_list("site", "code"))
        inserted = skipped_existing = skipped_unknown_group = 0

        with SOURCE_FILE.open(encoding="utf-8", newline="") as stream:
            for row in csv.DictReader(stream):
                site = row["site"]
                code = self._group_code(site, row["groupe_code_suffix"], known_codes)
                if code is None:
                    skipped_unknown_group += 1
                    self.stdout.write(
                        self.style.WARNING(
                            f"Groupe introuvable, ligne ignorée : {site} / GE{row['groupe_code_suffix']}."
                        )
                    )
                    continue

                if GeneratorFuelConsumption.objects.filter(
                    site=site,
                    periode=row["periode"],
                    groupe_code=code,
                ).exists():
                    skipped_existing += 1
                    continue

                consumption = Decimal(row["consommation_litres"])
                hours = Decimal(row["heures_ge"])
                litres_per_hour = (
                    (consumption / hours).quantize(Decimal("0.001"))
                    if hours > 0
                    else Decimal("0")
                )
                GeneratorFuelConsumption.objects.create(
                    id=uuid.uuid4(),
                    site=site,
                    periode=row["periode"],
                    groupe_code=code,
                    consommation_litres=consumption,
                    heures_ge=hours,
                    litres_heure=litres_per_hour,
                    commentaires=IMPORT_COMMENT,
                    created_by=actor.id,
                )
                inserted += 1

        self.stdout.write(
            self.style.SUCCESS(
                "Import GE 2026 terminé : "
                f"{inserted} ajoutée(s), {skipped_existing} déjà présente(s), "
                f"{skipped_unknown_group} ignorée(s), {removed_comments} commentaire(s) retiré(s)."
            )
        )

    @staticmethod
    def _group_code(site: str, suffix: str, known_codes: set[tuple[str, str]]) -> str | None:
        candidates = sorted(
            code
            for known_site, code in known_codes
            if known_site == site and code.endswith(f"-GE-{suffix}")
        )
        return candidates[0] if candidates else None
