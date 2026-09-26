import hashlib
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth.hashers import check_password
from django.core.exceptions import ValidationError
from django.db import connection
from django.test import RequestFactory, SimpleTestCase, TransactionTestCase, override_settings

from login_guard.models import PasswordHistory
from .local_auth import (
    PasswordCompromiseCheckUnavailable,
    change_password,
    set_local_password,
    validate_password,
)
from .models import LocalCredential
from .views import local_change_password


SAFE_PASSWORD = "Cobalt!Orbite-Unique-2026"


@override_settings(GMAO_PWNED_PASSWORD_CHECK=False)
class PasswordValidationTests(SimpleTestCase):
    def test_requires_at_least_fourteen_characters(self):
        with self.assertRaises(ValidationError):
            validate_password("Court-2026!!")
        self.assertEqual(validate_password(SAFE_PASSWORD), SAFE_PASSWORD)

    def test_rejects_common_and_numeric_passwords(self):
        for password in ("password123456", "12345678901234"):
            with self.subTest(password=password), self.assertRaises(ValidationError):
                validate_password(password)

    @override_settings(GMAO_PWNED_PASSWORD_CHECK=True)
    @patch("profiles.local_auth._fetch_pwned_range")
    def test_rejects_password_found_in_known_breaches(self, fetch_range):
        digest = hashlib.sha1(SAFE_PASSWORD.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
        fetch_range.return_value = f"{digest[5:]}:42\n{'0' * 35}:0\n"

        with self.assertRaisesMessage(ValidationError, "fuite de données"):
            validate_password(SAFE_PASSWORD)

        fetch_range.assert_called_once_with(digest[:5])

    @override_settings(GMAO_PWNED_PASSWORD_CHECK=True)
    @patch("profiles.local_auth._fetch_pwned_range")
    def test_fails_closed_when_compromise_check_is_unavailable(self, fetch_range):
        fetch_range.side_effect = PasswordCompromiseCheckUnavailable("indisponible")
        with self.assertRaises(PasswordCompromiseCheckUnavailable):
            validate_password(SAFE_PASSWORD)


@override_settings(
    GMAO_PWNED_PASSWORD_CHECK=False,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class PasswordHistoryTests(TransactionTestCase):
    created_credentials_table = False

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if LocalCredential._meta.db_table not in connection.introspection.table_names():
            with connection.schema_editor() as editor:
                editor.create_model(LocalCredential)
            cls.created_credentials_table = True

    @classmethod
    def tearDownClass(cls):
        if cls.created_credentials_table:
            with connection.schema_editor() as editor:
                editor.delete_model(LocalCredential)
        super().tearDownClass()

    def setUp(self):
        LocalCredential.objects.all().delete()
        PasswordHistory.objects.all().delete()
        self.profile_id = uuid4()

    def test_change_refuses_current_and_recent_passwords(self):
        first = "Orbite!Cobalt-2026-A"
        second = "Orbite!Cobalt-2026-B"
        set_local_password(self.profile_id, first)
        change_password(SimpleNamespace(id=self.profile_id), first, second)

        with self.assertRaisesMessage(ValidationError, "déjà été utilisé"):
            set_local_password(self.profile_id, first)
        with self.assertRaisesMessage(ValidationError, "déjà été utilisé"):
            set_local_password(self.profile_id, second)

        credential = LocalCredential.objects.get(profile_id=self.profile_id)
        self.assertTrue(check_password(second, credential.password_hash))
        self.assertEqual(PasswordHistory.objects.filter(profile_id=self.profile_id).count(), 1)

    def test_keeps_only_five_previous_hashes(self):
        passwords = [f"Orbite!Cobalt-2026-{index}" for index in range(7)]
        for password in passwords:
            set_local_password(self.profile_id, password)

        self.assertEqual(PasswordHistory.objects.filter(profile_id=self.profile_id).count(), 5)


class PasswordEndpointTests(SimpleTestCase):
    @patch("profiles.views.profile_from_token")
    @patch("profiles.views.change_password")
    def test_returns_503_when_compromise_service_is_unavailable(self, change, profile_from_token):
        change.side_effect = PasswordCompromiseCheckUnavailable("Contrôle indisponible.")
        profile_from_token.return_value = SimpleNamespace(id=uuid4())
        request = RequestFactory().post(
            "/api/auth/local/change-password",
            data=json.dumps({"currentPassword": "old", "newPassword": SAFE_PASSWORD}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer test-token",
        )

        response = local_change_password(request)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)["code"], "password_check_unavailable")
