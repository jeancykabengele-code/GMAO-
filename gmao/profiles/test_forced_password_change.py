import json
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone

from .local_auth import issue_token, set_local_password
from .models import LocalCredential, UserProfile


PASSWORD = "Phrase-longue-2026!"
NEW_PASSWORD = "Autre-phrase-durable-2026!"


@override_settings(GMAO_PWNED_PASSWORD_CHECK=False)
class ForcedPasswordChangeTests(TestCase):
    def setUp(self):
        self.administrator = UserProfile.objects.create(
            id=uuid4(), email="admin@example.com", full_name="Administrateur",
            role="administrator", site=None, active=True, created_at=timezone.now(),
        )
        set_local_password(self.administrator.id, PASSWORD)
        self.admin_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_token(self.administrator)}"}

    def login(self, email, password):
        return self.client.post(
            "/api/auth/local/login",
            data=json.dumps({"email": email, "password": password}),
            content_type="application/json",
        )

    def test_account_created_by_the_administrator_must_change_password_on_first_login(self):
        created = self.client.post(
            "/api/profiles",
            data=json.dumps({
                "email": "operations@example.com", "fullName": "Chargé des opérations",
                "role": "charge_operations", "site": None, "password": PASSWORD,
            }),
            content_type="application/json", **self.admin_auth,
        )
        self.assertEqual(created.status_code, 201, created.content)

        response = self.login("operations@example.com", PASSWORD)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["profile"]["mustChangePassword"])

    def test_administrator_password_reset_forces_a_change(self):
        target = UserProfile.objects.create(
            id=uuid4(), email="target@example.com", full_name="Cible",
            role="charge_operations", site=None, active=True, created_at=timezone.now(),
        )
        set_local_password(target.id, PASSWORD)
        self.assertFalse(LocalCredential.objects.get(profile_id=target.id).must_change_password)

        reset = self.client.post(
            f"/api/profiles/{target.id}/password",
            data=json.dumps({"password": NEW_PASSWORD, "managerPassword": PASSWORD}),
            content_type="application/json", **self.admin_auth,
        )
        self.assertEqual(reset.status_code, 200, reset.content)

        response = self.login("target@example.com", NEW_PASSWORD)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["profile"]["mustChangePassword"])

    def test_self_service_change_does_not_force_another_change(self):
        response = self.login("admin@example.com", PASSWORD)
        self.assertFalse(response.json()["profile"]["mustChangePassword"])
        token = response.json()["accessToken"]

        changed = self.client.post(
            "/api/auth/local/change-password",
            data=json.dumps({"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD}),
            content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(changed.status_code, 200, changed.content)
        new_token = changed.json()["accessToken"]

        me = self.client.get("/api/me", HTTP_AUTHORIZATION=f"Bearer {new_token}")
        self.assertFalse(me.json()["mustChangePassword"])

    def test_other_routes_are_blocked_until_the_password_is_changed_then_unblocked(self):
        manager = UserProfile.objects.create(
            id=uuid4(), email="manager@example.com", full_name="Manager",
            role="manager", site=None, active=True, created_at=timezone.now(),
        )
        set_local_password(manager.id, PASSWORD, must_change_password=True)

        login = self.login("manager@example.com", PASSWORD)
        self.assertTrue(login.json()["profile"]["mustChangePassword"])
        token = login.json()["accessToken"]
        auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

        blocked = self.client.get("/api/notifications", **auth)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["code"], "password_change_required")

        me = self.client.get("/api/me", **auth)
        self.assertEqual(me.status_code, 200)

        changed = self.client.post(
            "/api/auth/local/change-password",
            data=json.dumps({"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD}),
            content_type="application/json", **auth,
        )
        self.assertEqual(changed.status_code, 200, changed.content)
        new_token = changed.json()["accessToken"]

        unblocked = self.client.get("/api/notifications", HTTP_AUTHORIZATION=f"Bearer {new_token}")
        self.assertEqual(unblocked.status_code, 200)
