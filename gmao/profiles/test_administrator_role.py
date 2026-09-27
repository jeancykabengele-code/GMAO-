import json
from uuid import uuid4

from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from login_guard.models import AuditLog

from .models import LocalCredential, UserProfile
from .sites import site_collection
from .users_admin import profile_collection, profile_detail


class AdministratorHandoffTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.manager = UserProfile.objects.create(
            id=uuid4(),
            email="manager@example.com",
            full_name="Manager",
            role="manager",
            site=None,
            active=True,
            created_at=timezone.now(),
        )

    @staticmethod
    def _authenticated(request, profile):
        request.gmao_profile = profile
        return request

    @override_settings(GMAO_PWNED_PASSWORD_CHECK=False)
    def test_manager_can_create_first_administrator_then_loses_access(self):
        request = self._authenticated(
            self.factory.post(
                "/api/profiles",
                data=json.dumps({
                    "email": "administrator@example.com",
                    "fullName": "Administrateur",
                    "role": "administrator",
                    "site": None,
                    "password": "Phrase-de-passe-longue-2026!",
                }),
                content_type="application/json",
            ),
            self.manager,
        )

        response = profile_collection.__wrapped__.__wrapped__(request)

        self.assertEqual(response.status_code, 201)
        administrator = UserProfile.objects.get(email="administrator@example.com")
        self.assertEqual(administrator.role, "administrator")
        self.assertTrue(administrator.active)
        self.assertTrue(LocalCredential.objects.filter(profile_id=administrator.id).exists())
        self.assertTrue(AuditLog.objects.filter(action="profile_create", target_id=str(administrator.id)).exists())

        denied = self._authenticated(self.factory.get("/api/profiles"), self.manager)
        self.assertEqual(profile_collection.__wrapped__.__wrapped__(denied).status_code, 403)

        allowed = self._authenticated(self.factory.get("/api/profiles"), administrator)
        self.assertEqual(profile_collection.__wrapped__.__wrapped__(allowed).status_code, 200)

    def test_last_administrator_cannot_change_own_role(self):
        administrator = UserProfile.objects.create(
            id=uuid4(),
            email="administrator@example.com",
            full_name="Administrateur",
            role="administrator",
            site=None,
            active=True,
            created_at=timezone.now(),
        )
        request = self._authenticated(
            self.factory.patch(
                f"/api/profiles/{administrator.id}",
                data=json.dumps({"role": "manager"}),
                content_type="application/json",
            ),
            administrator,
        )

        response = profile_detail.__wrapped__.__wrapped__(request, administrator.id)

        self.assertEqual(response.status_code, 400)
        self.assertIn("dernier Administrateur actif", json.loads(response.content)["detail"])
        administrator.refresh_from_db()
        self.assertEqual(administrator.role, "administrator")

    def test_only_administrator_can_create_sites_after_handoff(self):
        administrator = UserProfile.objects.create(
            id=uuid4(),
            email="administrator@example.com",
            full_name="Administrateur",
            role="administrator",
            site=None,
            active=True,
            created_at=timezone.now(),
        )
        payload = json.dumps({"name": "Kinshasa", "code": "KIN"})
        manager_request = self._authenticated(
            self.factory.post("/api/sites", data=payload, content_type="application/json"),
            self.manager,
        )
        admin_request = self._authenticated(
            self.factory.post("/api/sites", data=payload, content_type="application/json"),
            administrator,
        )

        self.assertEqual(site_collection.__wrapped__.__wrapped__(manager_request).status_code, 403)
        self.assertEqual(site_collection.__wrapped__.__wrapped__(admin_request).status_code, 201)
