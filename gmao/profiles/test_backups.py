import json
import zipfile
from io import BytesIO
from uuid import uuid4

from django.test import RequestFactory, TestCase
from django.utils import timezone

from login_guard.models import AuditLog

from .backups import backup_export
from .models import Site, UserProfile


def undecorated(view):
    return view.__wrapped__.__wrapped__


class BackupExportTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.manager = UserProfile.objects.create(
            id=uuid4(), email="manager@example.com", full_name="Manager",
            role="manager", site=None, active=True, created_at=timezone.now(),
        )

    def _authenticated(self, request, profile):
        request.gmao_profile = profile
        return request

    def test_manager_can_export_before_any_administrator_exists(self):
        request = self._authenticated(self.factory.post("/api/backups/export"), self.manager)

        response = undecorated(backup_export)(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")

    def test_manager_is_denied_once_an_administrator_exists(self):
        UserProfile.objects.create(
            id=uuid4(), email="admin@example.com", full_name="Administrateur",
            role="administrator", site=None, active=True, created_at=timezone.now(),
        )
        request = self._authenticated(self.factory.post("/api/backups/export"), self.manager)

        response = undecorated(backup_export)(request)

        self.assertEqual(response.status_code, 403)

    def test_administrator_export_contains_data_excludes_credentials_and_is_audited(self):
        administrator = UserProfile.objects.create(
            id=uuid4(), email="admin@example.com", full_name="Administrateur",
            role="administrator", site=None, active=True, created_at=timezone.now(),
        )
        Site.objects.create(name="Goma", code="GOM", active=True)
        request = self._authenticated(self.factory.post("/api/backups/export"), administrator)

        response = undecorated(backup_export)(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn('filename="gmao-backup-', response["Content-Disposition"])
        archive = zipfile.ZipFile(BytesIO(response.content))
        names = archive.namelist()
        self.assertIn("sites.json", names)
        self.assertIn("manifest.json", names)
        self.assertIn("audit_log.json", names)
        self.assertNotIn("gmao_local_credentials.json", names)
        self.assertNotIn("gmao_password_history.json", names)
        self.assertNotIn("gmao_login_buckets.json", names)
        manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual(manifest["exportedBy"], "admin@example.com")
        self.assertGreaterEqual(manifest["rowCounts"]["sites"], 1)
        self.assertTrue(AuditLog.objects.filter(action="backup_export", actor_id=administrator.id).exists())

    def test_get_is_rejected(self):
        administrator = UserProfile.objects.create(
            id=uuid4(), email="admin@example.com", full_name="Administrateur",
            role="administrator", site=None, active=True, created_at=timezone.now(),
        )
        request = self._authenticated(self.factory.get("/api/backups/export"), administrator)

        response = undecorated(backup_export)(request)

        self.assertEqual(response.status_code, 405)
