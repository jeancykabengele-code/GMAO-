import json
import zipfile
from io import BytesIO

from django.test import TestCase, override_settings

from login_guard.models import AuditLog

from .models import Site


@override_settings(GMAO_BACKUP_TOKEN="scheduled-backup-test-secret")
class ScheduledBackupExportTests(TestCase):
    def test_missing_or_invalid_authorization_is_rejected(self):
        for authorization in ("", "Bearer", "Bearer ", "Basic scheduled-backup-test-secret",
                              "Bearer wrong", "Bearer échec"):
            with self.subTest(authorization=authorization):
                response = self.client.post("/api/backups/scheduled-export", HTTP_AUTHORIZATION=authorization)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response["WWW-Authenticate"], "Bearer")
        self.assertFalse(AuditLog.objects.filter(action="backup_export").exists())

    @override_settings(GMAO_BACKUP_TOKEN="")
    def test_unconfigured_secret_fails_closed(self):
        response = self.client.post(
            "/api/backups/scheduled-export", HTTP_AUTHORIZATION="Bearer scheduled-backup-test-secret",
        )
        self.assertEqual(response.status_code, 401)

    def test_non_post_methods_are_rejected(self):
        for method in ("get", "put", "patch", "delete"):
            response = getattr(self.client, method)(
                "/api/backups/scheduled-export", HTTP_AUTHORIZATION="Bearer scheduled-backup-test-secret",
            )
            self.assertEqual(response.status_code, 405)

    def test_authorized_request_returns_the_archive_and_is_audited(self):
        Site.objects.create(name="Goma", code="GOM", active=True)

        response = self.client.post(
            "/api/backups/scheduled-export", HTTP_AUTHORIZATION="Bearer scheduled-backup-test-secret",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")
        self.assertIn('filename="gmao-backup-', response["Content-Disposition"])
        archive = zipfile.ZipFile(BytesIO(response.content))
        names = archive.namelist()
        self.assertIn("sites.json", names)
        self.assertIn("manifest.json", names)
        self.assertNotIn("gmao_local_credentials.json", names)
        manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual(manifest["exportedBy"], "scheduled-backup")

        entry = AuditLog.objects.get(action="backup_export")
        self.assertIsNone(entry.actor_id)
        self.assertEqual(entry.actor_email, "scheduled-backup")
        self.assertTrue(entry.details.get("scheduled"))
