"""Prépare une base SQLite jetable pour les tests de bout en bout du navigateur.

Usage (depuis gmao/) :
    GMAO_SQLITE_PATH=/tmp/e2e.sqlite3 E2E_ADMIN_PASSWORD=... E2E_CHEF_PASSWORD=... python scripts/seed_e2e.py

Le script refuse de tourner sans GMAO_SQLITE_PATH afin de ne jamais toucher la base MySQL de production.
Les mots de passe viennent de l'environnement : aucun identifiant n'est enregistré dans le dépôt.
"""

import os
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gmao_backend.settings")

if not os.getenv("GMAO_SQLITE_PATH") or os.getenv("GMAO_DATABASE_ENGINE") == "mysql":
    sys.exit("seed_e2e.py n'écrit que dans une base SQLite explicite (GMAO_SQLITE_PATH).")

import django  # noqa: E402

django.setup()

from django.core.management import call_command  # noqa: E402

from profiles.local_auth import set_local_password  # noqa: E402
from profiles.models import Equipment, GeneratorRecord, Site, UserProfile  # noqa: E402


def main():
    call_command("migrate", verbosity=0)
    Site.objects.get_or_create(name="Goma", defaults={"code": "GOM", "active": True})
    for email, name, role, site, variable in (
        ("e2e-admin@example.test", "Administrateur E2E", "administrator", None, "E2E_ADMIN_PASSWORD"),
        ("e2e-chef@example.test", "Chef de site E2E", "chef_site", "Goma", "E2E_CHEF_PASSWORD"),
    ):
        profile, _ = UserProfile.objects.get_or_create(
            email=email, defaults={"id": uuid4(), "full_name": name, "role": role, "site": site, "active": True},
        )
        set_local_password(profile.id, os.environ[variable], must_change_password=False)
    author = uuid4()
    Equipment.objects.get_or_create(
        site="Goma", code="EQ-GOM-0001",
        defaults=dict(nom="Groupe électrogène 1", famille="Energie", localisation="Salle GE", marque_modele="Groupe GE",
                      etat="Actif", criticite="Haute", created_by=author),
    )
    GeneratorRecord.objects.get_or_create(
        site="Goma", code="EQ-GOM-0001",
        defaults=dict(type_ge="Groupe électrogène 1", mois_releve="2026-01", rh_actuel=0, rh_derniere_pm=0,
                      rh_depuis_derniere_pm=0, rh_prochaine_pm=250, etat="Normal", created_by=author),
    )
    print("Base E2E prête.")


main()
