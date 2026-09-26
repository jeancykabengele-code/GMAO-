from unittest.mock import patch

from django.test import SimpleTestCase, override_settings


@override_settings(GMAO_HEALTH_TOKEN="monitoring-test-secret")
class DatabaseHealthTests(SimpleTestCase):
    @patch("profiles.views.connection")
    def test_public_health_does_not_access_database(self, connection):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "UP"})
        connection.cursor.assert_not_called()

    @patch("profiles.views.connection")
    def test_missing_or_invalid_authorization_never_accesses_database(self, connection):
        for authorization in ("", "Bearer", "Bearer ", "Basic monitoring-test-secret",
                              "Bearer wrong", "Bearer user-session-token", "Bearer échec"):
            with self.subTest(authorization=authorization):
                response = self.client.get("/health/database", HTTP_AUTHORIZATION=authorization)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {"detail": "Accès non autorisé."})
                self.assertEqual(response["WWW-Authenticate"], "Bearer")
                self.assertIn("no-store", response["Cache-Control"])
        connection.cursor.assert_not_called()

    @override_settings(GMAO_HEALTH_TOKEN="")
    @patch("profiles.views.connection")
    def test_unconfigured_secret_fails_closed(self, connection):
        for authorization in ("", "Bearer ", "Bearer monitoring-test-secret"):
            response = self.client.get("/health/database", HTTP_AUTHORIZATION=authorization)
            self.assertEqual(response.status_code, 401)
        connection.cursor.assert_not_called()

    @patch("profiles.views.connection")
    def test_query_parameter_cannot_authenticate(self, connection):
        response = self.client.get("/health/database?token=monitoring-test-secret")
        self.assertEqual(response.status_code, 401)
        connection.cursor.assert_not_called()

    @patch("profiles.views.connection")
    def test_authorized_probe_only_checks_connectivity(self, connection):
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        response = self.client.get("/health/database", HTTP_AUTHORIZATION="bearer monitoring-test-secret")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), {"status", "database", "responseTimeMs"})
        self.assertEqual(payload["status"], "UP")
        self.assertEqual(payload["database"], "UP")
        self.assertIsInstance(payload["responseTimeMs"], int)
        self.assertGreaterEqual(payload["responseTimeMs"], 0)
        self.assertIn("no-store", response["Cache-Control"])
        cursor.execute.assert_called_once_with("select 1")
        cursor.fetchone.assert_called_once_with()

    @patch("profiles.views.connection")
    def test_connection_failure_does_not_expose_sql_details(self, connection):
        connection.cursor.side_effect = RuntimeError("MySQL password=secret host=private table=user_profiles")
        self.assert_sanitized_failure()

    @patch("profiles.views.connection")
    def test_query_failure_does_not_expose_sql_details(self, connection):
        connection.cursor.return_value.__enter__.return_value.execute.side_effect = RuntimeError("SELECT secret FROM private_table")
        self.assert_sanitized_failure()

    def assert_sanitized_failure(self):
        with self.assertLogs("profiles.views", level="WARNING") as logs:
            response = self.client.get("/health/database", HTTP_AUTHORIZATION="Bearer monitoring-test-secret")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "DOWN", "database": "DOWN"})
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(len(logs.records), 1)
        self.assertIsNone(logs.records[0].exc_info)
        self.assertNotIn("secret", logs.output[0])

    @patch("profiles.views.connection")
    def test_non_get_methods_are_rejected(self, connection):
        for method in ("post", "put", "patch", "delete", "head"):
            response = getattr(self.client, method)(
                "/health/database", HTTP_AUTHORIZATION="Bearer monitoring-test-secret",
            )
            self.assertEqual(response.status_code, 405)
        connection.cursor.assert_not_called()
