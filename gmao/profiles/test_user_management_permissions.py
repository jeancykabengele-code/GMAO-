import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.test import RequestFactory, SimpleTestCase

from .local_auth import LocalAuthenticationError
from .users_admin import profile_collection, profile_delete, profile_detail, profile_password


def undecorated(view):
    return view.__wrapped__.__wrapped__


class UserManagementAuthorizationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.operations_lead = SimpleNamespace(id=uuid4(), role="charge_operations", site=None)

    def test_operations_lead_is_denied_on_every_user_management_route(self):
        profile_id = uuid4()
        requests = [
            (profile_collection, self.factory.get("/api/profiles"), ()),
            (profile_collection, self.factory.post("/api/profiles", data="{}", content_type="application/json"), ()),
            (profile_detail, self.factory.patch(f"/api/profiles/{profile_id}", data="{}", content_type="application/json"), (profile_id,)),
            (profile_delete, self.factory.delete(f"/api/profiles/{profile_id}/delete"), (profile_id,)),
            (profile_password, self.factory.post(f"/api/profiles/{profile_id}/password", data="{}", content_type="application/json"), (profile_id,)),
        ]

        for view, request, args in requests:
            with self.subTest(view=view.__name__, method=request.method):
                request.gmao_profile = self.operations_lead
                response = undecorated(view)(request, *args)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(json.loads(response.content)["code"], "profile_admin_denied")


class PasswordResetReauthenticationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.manager = SimpleNamespace(id=uuid4(), role="manager", site=None)
        self.target = SimpleNamespace(id=uuid4(), active=True)

    def request(self, manager_password="Manager-current-password"):
        request = self.factory.post(
            f"/api/profiles/{self.target.id}/password",
            data=json.dumps({
                "password": "Target-new-password-2026",
                "managerPassword": manager_password,
            }),
            content_type="application/json",
        )
        request.gmao_profile = self.manager
        return request

    @patch("profiles.users_admin.set_local_password")
    @patch("profiles.users_admin.verify_current_password")
    @patch("profiles.users_admin.UserProfile.objects")
    def test_manager_must_reauthenticate_before_reset(self, profiles, verify, set_password):
        profiles.get.return_value = self.target

        response = undecorated(profile_password)(self.request(), self.target.id)

        self.assertEqual(response.status_code, 200)
        verify.assert_called_once_with(self.manager, "Manager-current-password")
        set_password.assert_called_once_with(self.target.id, "Target-new-password-2026")

    @patch("profiles.users_admin.set_local_password")
    @patch("profiles.users_admin.verify_current_password")
    @patch("profiles.users_admin.UserProfile.objects")
    def test_wrong_or_missing_manager_password_blocks_reset(self, profiles, verify, set_password):
        profiles.get.return_value = self.target
        verify.side_effect = LocalAuthenticationError("Le mot de passe actuel du Manager est incorrect.")

        for manager_password in ("wrong", ""):
            with self.subTest(manager_password=manager_password):
                response = undecorated(profile_password)(self.request(manager_password), self.target.id)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(json.loads(response.content)["code"], "manager_reauthentication_failed")

        set_password.assert_not_called()
