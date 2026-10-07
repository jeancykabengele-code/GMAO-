import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connection, transaction
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from login_guard.limiter import Admission
from login_guard.models import AuditLog

from .audit import audit_collection, record_audit
from .change_history import change_history_collection
from .local_auth import LocalAuthenticationError
from .views import local_login


@override_settings(GMAO_LOGIN_TRUST_RENDER_PROXY=False)
class AuditLogPersistenceTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory(REMOTE_ADDR="192.0.2.10")
        self.manager = SimpleNamespace(id=uuid4(), email="manager@example.com", role="manager")

    def test_records_and_filters_events_without_secrets(self):
        request = self.factory.get("/api/audit-logs?action=profile_update&result=success&actor=manager")
        request.gmao_profile = self.manager
        entry = record_audit(request, "profile_update", "profile", uuid4(), details={"old": {"role": "chef_site"}, "new": {"role": "charge_operations"}})

        response = audit_collection.__wrapped__.__wrapped__(request)

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["items"][0]["id"], entry.id)
        self.assertEqual(payload["items"][0]["ipAddress"], "192.0.2.10")
        self.assertNotIn("password", json.dumps(payload).lower())

    def test_rejects_secret_fields_before_writing(self):
        request = self.factory.post("/api/example")
        request.gmao_profile = self.manager
        with self.assertRaisesRegex(ValueError, "secret"):
            record_audit(request, "test", "profile", details={"password": "never-store-this"})
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_application_and_database_both_block_mutation(self):
        request = self.factory.post("/api/example")
        request.gmao_profile = self.manager
        entry = record_audit(request, "test", "profile")
        entry.result = "failure"
        with self.assertRaisesRegex(TypeError, "immuable"):
            entry.save()
        with self.assertRaisesRegex(TypeError, "immuable"):
            AuditLog.objects.filter(id=entry.id).delete()
        with self.assertRaises(DatabaseError):
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("UPDATE audit_log SET result = %s WHERE id = %s", ["failure", entry.id])
        entry.refresh_from_db()
        self.assertEqual(entry.result, "success")

    def test_operations_lead_cannot_read_audit_log(self):
        request = self.factory.get("/api/audit-logs")
        request.gmao_profile = SimpleNamespace(id=uuid4(), email="operations@example.com", role="charge_operations")
        response = audit_collection.__wrapped__.__wrapped__(request)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "audit_log_denied")


class LoginAuditTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory(REMOTE_ADDR="192.0.2.20")

    @patch("profiles.audit.record_audit")
    @patch("profiles.views._serialize_profile", return_value={"id": "manager"})
    @patch("profiles.views.issue_token", return_value="signed-token")
    @patch("profiles.views.authenticate")
    @patch("profiles.views.reserve_attempt", return_value=Admission(0, "pair", "opaque"))
    def test_successful_login_is_audited(self, reserve, authenticate, issue_token, serialize, audit):
        profile = SimpleNamespace(id=uuid4(), email="manager@example.com")
        authenticate.return_value = (profile, SimpleNamespace(must_change_password=False))
        request = self.factory.post("/api/auth/local/login", data=json.dumps({"email": profile.email, "password": "not-logged"}), content_type="application/json")

        response = local_login(request)

        self.assertEqual(response.status_code, 200)
        audit.assert_called_once()
        self.assertEqual(audit.call_args.args[1:3], ("login", "session"))
        self.assertEqual(audit.call_args.kwargs["target_id"], profile.id)
        self.assertNotIn("not-logged", repr(audit.call_args))

    @patch("profiles.audit.record_audit")
    @patch("profiles.views.authenticate", side_effect=LocalAuthenticationError("Identifiants invalides."))
    @patch("profiles.views.reserve_attempt", return_value=Admission(0, "pair", "opaque"))
    def test_failed_login_is_audited_without_password(self, reserve, authenticate, audit):
        request = self.factory.post("/api/auth/local/login", data=json.dumps({"email": "unknown@example.com", "password": "not-logged"}), content_type="application/json")

        response = local_login(request)

        self.assertEqual(response.status_code, 401)
        audit.assert_called_once()
        self.assertEqual(audit.call_args.kwargs["result"], "failure")
        self.assertNotIn("not-logged", repr(audit.call_args))


class ChangeHistoryTests(TestCase):
    def _request(self, query=None):
        request = RequestFactory().get("/api/change-history", query or {})
        request.gmao_profile = SimpleNamespace(id=uuid4(), email="manager@example.com", role="manager")
        return request

    def _history(self, query=None):
        return json.loads(change_history_collection.__wrapped__.__wrapped__(self._request(query)).content)

    def test_history_is_separate_from_the_audit_log_and_filterable(self):
        AuditLog.objects.create(action="record_update", target_type="releves-rh-ge", result="success", ip_address="1.1.1.1", actor_email="chef@example.com",
            details={"site": "Goma", "old": {"site": "Goma", "groupeCode": "GE-01", "periode": "2026-01", "rhActuel": 100.0, "commentaires": ""},
                     "new": {"site": "Goma", "groupeCode": "GE-01", "periode": "2026-01", "rhActuel": 120.5, "commentaires": "corrigé"}})
        AuditLog.objects.create(action="rh_reading_create", target_type="releves-rh-ge", result="success", ip_address="1.1.1.1",
            details={"new": {"site": "Goma", "groupeCode": "GE-02", "periode": "2026-01", "rhActuel": "10.00"}})
        AuditLog.objects.create(action="record_create", target_type="tickets", result="success", ip_address="1.1.1.1",
            details={"site": "Utex", "new": {"site": "Utex", "numero": "T-1", "motif": "Panne", "description": ""}})
        AuditLog.objects.create(action="record_delete", target_type="equipements", result="success", ip_address="1.1.1.1",
            details={"site": "Utex", "old": {"site": "Utex", "code": "EQ-UTE-0001", "nom": "Onduleur"}})
        AuditLog.objects.create(action="record_delete", target_type="equipements", result="success", ip_address="1.1.1.1", details={"site": "Goma"})

        audit = json.loads(audit_collection.__wrapped__.__wrapped__(self._request()).content)
        self.assertEqual({item["action"] for item in audit["items"]}, {"record_delete"})

        history = self._history()
        self.assertEqual(history["total"], 4)
        update = next(item for item in history["items"] if item["kind"] == "update")
        self.assertEqual(update["resource"], "releves-rh-ge")
        self.assertEqual(update["reference"], "GE-01 · 2026-01")
        self.assertEqual(update["actorEmail"], "chef@example.com")
        self.assertEqual(
            sorted((change["field"], change["old"], change["new"]) for change in update["changes"]),
            [("commentaires", "", "corrigé"), ("rhActuel", 100.0, 120.5)],
        )
        deletion = next(item for item in history["items"] if item["kind"] == "delete")
        self.assertEqual(deletion["reference"], "EQ-UTE-0001")
        self.assertEqual([change["field"] for change in deletion["changes"]], ["code", "nom"])
        for query, expected in (({"site": "Goma"}, 2), ({"group": "GE-02"}, 1), ({"resource": "tickets"}, 1), ({"resource": "equipements"}, 1), ({"site": "Utex", "group": "GE-01"}, 0)):
            self.assertEqual(self._history(query)["total"], expected, query)

    def test_unknown_resource_is_rejected(self):
        response = change_history_collection.__wrapped__.__wrapped__(self._request({"resource": "inconnu"}))
        self.assertEqual(response.status_code, 400)
