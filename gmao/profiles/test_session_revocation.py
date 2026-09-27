import json
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from .local_auth import DUMMY_PASSWORD_HASH, authenticate, issue_token, set_local_password
from .local_auth import LocalAuthenticationError
from .models import LocalCredential, Site, UserProfile


PASSWORD = "Phrase-longue-2026!"
REPLACEMENT = "Autre-phrase-durable-2026!"


@override_settings(GMAO_PWNED_PASSWORD_CHECK=False)
class SessionRevocationTests(TestCase):
    def setUp(self):
        self.manager = UserProfile.objects.create(
            id=uuid4(), email="manager@example.com", full_name="Manager GMAO",
            role="manager", site=None, active=True, created_at=timezone.now(),
        )
        set_local_password(self.manager.id, PASSWORD)
        self.token = issue_token(self.manager)

    def test_logout_rejects_the_previous_token(self):
        response = self.client.post("/api/auth/local/logout", HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, 200)
        follow_up = self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(follow_up.status_code, 401)

    def test_password_change_rejects_the_previous_token_and_returns_a_new_one(self):
        response = self.client.post(
            "/api/auth/local/change-password",
            data=json.dumps({"currentPassword": PASSWORD, "newPassword": REPLACEMENT}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        new_token = response.json()["accessToken"]
        self.assertNotEqual(new_token, self.token)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {self.token}").status_code, 401)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {new_token}").status_code, 200)

    def test_password_reset_rejects_the_previous_token(self):
        set_local_password(self.manager.id, REPLACEMENT)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {self.token}").status_code, 401)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {issue_token(self.manager)}").status_code, 200)

    def test_deactivation_rejects_the_token_even_after_reactivation(self):
        Site.objects.create(name="Goma", code="GOM", active=True)
        target = UserProfile.objects.create(
            id=uuid4(), email="chef@example.com", full_name="Chef Goma",
            role="chef_site", site="Goma", active=True, created_at=timezone.now(),
        )
        set_local_password(target.id, PASSWORD)
        target_token = issue_token(target)

        deactivated = self.client.patch(
            f"/api/profiles/{target.id}",
            data=json.dumps({"fullName": "Chef Goma", "role": "chef_site", "site": "Goma", "active": False}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(deactivated.status_code, 200)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {target_token}").status_code, 401)

        reactivated = self.client.patch(
            f"/api/profiles/{target.id}",
            data=json.dumps({"fullName": "Chef Goma", "role": "chef_site", "site": "Goma", "active": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(reactivated.status_code, 200)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {target_token}").status_code, 401)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {issue_token(target)}").status_code, 200)

    def test_token_without_session_version_is_rejected(self):
        from django.core import signing
        from .local_auth import TOKEN_SALT

        legacy = signing.dumps({"sub": str(self.manager.id)}, salt=TOKEN_SALT, compress=True)
        self.assertEqual(self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {legacy}").status_code, 401)

    def test_missing_account_checks_the_dummy_hash(self):
        from unittest.mock import patch

        with patch("profiles.local_auth.check_password", return_value=False) as check:
            with self.assertRaises(LocalAuthenticationError):
                authenticate("absent@example.com", "mot-de-passe")
        check.assert_called_once_with("mot-de-passe", DUMMY_PASSWORD_HASH)

    def test_known_account_checks_the_stored_hash(self):
        from unittest.mock import patch

        stored = LocalCredential.objects.get(profile_id=self.manager.id).password_hash
        with patch("profiles.local_auth.check_password", return_value=False) as check:
            with self.assertRaises(LocalAuthenticationError):
                authenticate(self.manager.email, "mauvais-mot-de-passe")
        check.assert_called_once_with("mauvais-mot-de-passe", stored)
