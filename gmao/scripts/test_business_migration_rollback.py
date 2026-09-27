"""Teste l'adoption, le rollback non destructif et la réadoption du schéma."""
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


if os.getenv("GMAO_MIGRATION_ROLLBACK_TESTS") != "1":
    raise RuntimeError("Définir GMAO_MIGRATION_ROLLBACK_TESTS=1 pour exécuter ce test isolé.")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

temporary = None
if os.getenv("DJANGO_SETTINGS_MODULE", "gmao_backend.settings") == "gmao_backend.settings":
    temporary = TemporaryDirectory()
    os.environ["GMAO_SQLITE_PATH"] = str(Path(temporary.name) / "migration-rollback.sqlite3")

os.environ.setdefault("DJANGO_DEBUG", "false")
os.environ.setdefault("DJANGO_SECRET_KEY", "migration-rollback-test-secret-with-sufficient-length-2026")
os.environ.setdefault("GMAO_PWNED_PASSWORD_CHECK", "false")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gmao_backend.settings")

import django
django.setup()

from django.core.management import call_command
from django.db import connection


call_command("migrate", verbosity=0, interactive=False)
call_command("verify_business_schema", verbosity=0)
with connection.cursor() as cursor:
    cursor.execute("INSERT INTO sites (name, code, active) VALUES (%s, %s, %s)", ["Rollback-Test", "RBT", True])

call_command("migrate", "profiles", "zero", verbosity=0, interactive=False)
with connection.cursor() as cursor:
    cursor.execute("SELECT code FROM sites WHERE name = %s", ["Rollback-Test"])
    row = cursor.fetchone()
if row != ("RBT",):
    raise AssertionError("Le rollback a modifié ou supprimé les données métier.")

call_command("migrate", "profiles", verbosity=0, interactive=False)
call_command("verify_business_schema", verbosity=0)
print("Rollback non destructif validé: tables et données préservées, réadoption réussie.")

if temporary:
    connection.close()
    temporary.cleanup()
