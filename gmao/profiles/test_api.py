"""Route /me de l'API."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase

from .views import current_user


class ApiTests(TestCase):
    def test_authenticated_routes_are_csrf_exempt(self):
        self.assertTrue(current_user.csrf_exempt)

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "UP"})

    def test_me_requires_bearer_token(self):
        response = self.client.get("/api/me")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "missing_bearer_token")

    @patch("profiles.views.build_permissions")
    @patch("profiles.views.profile_from_token")
    def test_me_returns_profile_and_server_permissions(self, profile_from_token, permissions):
        user_id = uuid4()
        created_at = datetime(2026, 8, 19, tzinfo=timezone.utc)
        profile_from_token.return_value = SimpleNamespace(
            id=user_id,
            email="manager@example.com",
            full_name="Manager GMAO",
            role="manager",
            site=None,
            active=True,
            created_at=created_at,
        )
        permissions.return_value.as_dict.return_value = {
            "globalScope": True,
            "viewDashboard": True,
            "viewDocumentation": True,
            "createRecords": True,
            "modifyExisting": True,
            "deleteRecords": False,
            "manageUsers": True,
            "viewAuditLog": True,
            "allowedSites": ["Goma", "Utex"],
        }

        response = self.client.get("/api/me", HTTP_AUTHORIZATION="Bearer valid-token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["fullName"], "Manager GMAO")
        self.assertTrue(response.json()["permissions"]["modifyExisting"])
        self.assertFalse(response.json()["permissions"]["deleteRecords"])
