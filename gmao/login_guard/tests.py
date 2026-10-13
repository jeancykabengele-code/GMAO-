from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command
from django.db import DatabaseError, OperationalError, connections
from django.test import RequestFactory, SimpleTestCase, TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone

from profiles.local_auth import LocalAuthenticationError
from .limiter import IP_LIMIT, PAIR_LIMIT, WINDOW_SECONDS, bucket_key, client_address, reserve_attempt
from .models import LoginBucket


@override_settings(GMAO_TRUSTED_PROXIES=["127.0.0.1", "::1"])
class ClientAddressTests(SimpleTestCase):
    def test_direct_requests_ignore_all_forwarded_headers(self):
        request = RequestFactory().post("/", REMOTE_ADDR="192.0.2.10", HTTP_X_FORWARDED_FOR="192.0.2.20", HTTP_X_REAL_IP="192.0.2.30")
        self.assertEqual(client_address(request), "192.0.2.10")

    def test_trusted_proxy_uses_real_ip_not_forwarded_for(self):
        request = RequestFactory().post("/", REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP="192.0.2.10", HTTP_X_FORWARDED_FOR="192.0.2.20")
        self.assertEqual(client_address(request), "192.0.2.10")

    def test_untrusted_peer_cannot_choose_the_bucket_with_real_ip(self):
        request = RequestFactory().post("/", REMOTE_ADDR="203.0.113.8", HTTP_X_REAL_IP="192.0.2.10")
        self.assertEqual(client_address(request), "203.0.113.8")

    def test_missing_or_invalid_real_ip_cannot_bypass_limits(self):
        for value in ("", "invalid", "192.0.2.1,192.0.2.2"):
            request = RequestFactory().post("/", REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP=value)
            self.assertEqual(client_address(request), "unknown")

    def test_ipv6_interface_rotation_shares_a_bucket(self):
        for value in ("2001:db8::1", "2001:db8::abcd"):
            self.assertEqual(client_address(RequestFactory().post("/", REMOTE_ADDR=value)), "2001:db8::/64")

    def test_ipv4_mapped_ipv6_is_normalized(self):
        self.assertEqual(client_address(RequestFactory().post("/", REMOTE_ADDR="::ffff:192.0.2.1")), "192.0.2.1")


@override_settings(GMAO_TRUSTED_PROXIES=[])
class LoginLimiterTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.request = RequestFactory().post("/", REMOTE_ADDR="192.0.2.10")

    def reserve(self, offset=0, email="test@example.invalid", request=None):
        with patch("login_guard.limiter.timezone.now", return_value=self.now + timedelta(seconds=offset)):
            return reserve_attempt(request or self.request, email)

    def test_five_attempts_then_block_until_window_expires(self):
        for offset in (0, 1, 3, 7, 15):
            self.assertEqual(self.reserve(offset).retry_after, 0)
        result = self.reserve(31)
        self.assertEqual(result.retry_after, WINDOW_SECONDS - 31)
        self.assertEqual(result.scope, "pair")
        self.assertEqual(self.reserve(WINDOW_SECONDS).retry_after, 0)
        self.assertEqual(LoginBucket.objects.get(key=result.key).attempts, 1)

    def test_progressive_delays_and_rejections_do_not_extend_window(self):
        for offset, wait in ((0, 1), (1, 2), (3, 4), (7, 8)):
            self.assertEqual(self.reserve(offset).retry_after, 0)
            result = self.reserve(offset)
            self.assertEqual(result.retry_after, wait)
            count = LoginBucket.objects.get(key=result.key).attempts
            self.reserve(offset)
            self.assertEqual(LoginBucket.objects.get(key=result.key).attempts, count)

    def test_case_and_whitespace_share_the_same_identifier(self):
        self.reserve(email=" Test@Example.Invalid ")
        self.assertEqual(self.reserve(email="test@example.invalid").retry_after, 1)

    def test_different_addresses_have_independent_pair_budgets(self):
        self.reserve()
        other = RequestFactory().post("/", REMOTE_ADDR="192.0.2.11")
        self.assertEqual(self.reserve(request=other).retry_after, 0)

    def test_ip_limit_prevents_rotating_identifiers(self):
        for i in range(IP_LIMIT):
            self.assertEqual(self.reserve(email=f"user{i}@example.invalid").retry_after, 0)
        result = self.reserve(email="new@example.invalid")
        self.assertEqual(result.scope, "ip")
        self.assertEqual(result.retry_after, WINDOW_SECONDS)
        self.assertEqual(LoginBucket.objects.count(), IP_LIMIT + 1)

    def test_ip_bucket_created_after_request_clock_does_not_add_a_delay(self):
        later = self.now + timedelta(milliseconds=1)
        LoginBucket.objects.create(
            key=bucket_key("ip", "192.0.2.10"), window_started=later,
            next_allowed=later, attempts=1,
        )
        self.assertEqual(self.reserve().retry_after, 0)
        self.assertEqual(LoginBucket.objects.get(key=bucket_key("ip", "192.0.2.10")).attempts, 2)

    def test_stored_keys_do_not_contain_email_or_ip(self):
        self.reserve()
        for key in LoginBucket.objects.values_list("key", flat=True):
            self.assertRegex(key, r"^[0-9a-f]{64}$")

    def test_deadlock_rolls_back_both_counters_before_retry(self):
        original_save = LoginBucket.save
        pair_key = bucket_key("pair", "192.0.2.10\ntest@example.invalid")
        interrupted = False

        def interrupted_save(bucket, *args, **kwargs):
            nonlocal interrupted
            if bucket.key == pair_key and bucket.attempts == 1 and not interrupted:
                interrupted = True
                raise OperationalError(1213, "simulated deadlock")
            return original_save(bucket, *args, **kwargs)

        with patch.object(LoginBucket, "save", interrupted_save), patch("login_guard.limiter.sleep"):
            self.assertEqual(self.reserve().retry_after, 0)
        self.assertTrue(interrupted)
        self.assertEqual(list(LoginBucket.objects.values_list("attempts", flat=True)), [1, 1])

    @patch("login_guard.limiter.sleep")
    @patch("login_guard.limiter._reserve_attempt", side_effect=OperationalError(1213, "persistent deadlock"))
    def test_persistent_deadlock_has_bounded_retries(self, reserve, sleep):
        with self.assertRaises(OperationalError):
            self.reserve()
        self.assertEqual(reserve.call_count, 5)
        self.assertEqual(sleep.call_count, 4)

    @patch("login_guard.limiter._reserve_attempt", side_effect=OperationalError(2003, "connection unavailable"))
    def test_other_database_errors_are_not_retried(self, reserve):
        with self.assertRaises(OperationalError):
            self.reserve()
        reserve.assert_called_once()

    def test_cleanup_preserves_active_buckets(self):
        self.reserve()
        LoginBucket.objects.create(key="expired", attempts=5, window_started=self.now - timedelta(days=2), next_allowed=self.now - timedelta(days=2))
        call_command("purge_login_buckets", verbosity=0)
        self.assertEqual(LoginBucket.objects.count(), 2)

    @patch("profiles.views.authenticate", side_effect=LocalAuthenticationError("Identifiants incorrects."))
    def test_api_blocks_before_password_check_and_logs_no_credentials(self, authenticate):
        data = {"email": "private@example.invalid", "password": "never-log-this-password"}
        first = self.client.post("/api/auth/local/login", data, content_type="application/json")
        self.assertEqual(first.status_code, 401)
        with self.assertLogs("profiles.views", level="WARNING") as logs:
            response = self.client.post("/api/auth/local/login", data, content_type="application/json")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "login_rate_limited")
        self.assertGreaterEqual(int(response["Retry-After"]), 1)
        self.assertEqual(response.json()["retryAfter"], int(response["Retry-After"]))
        self.assertIn("no-store", response["Cache-Control"])
        authenticate.assert_called_once()
        self.assertNotIn(data["email"], str(logs.output))
        self.assertNotIn(data["password"], str(logs.output))

    @patch("profiles.views.authenticate")
    @patch("profiles.views.reserve_attempt", side_effect=DatabaseError("sensitive SQL error"))
    def test_storage_outage_refuses_login_without_bypassing_protection(self, reserve, authenticate):
        with self.assertLogs("profiles.views", level="ERROR") as logs:
            response = self.client.post("/api/auth/local/login", {}, content_type="application/json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "login_unavailable")
        self.assertNotIn("sensitive", response.content.decode())
        self.assertNotIn("sensitive", str(logs.output))
        authenticate.assert_not_called()

    @patch("profiles.views._serialize_profile", return_value={"active": True})
    @patch("profiles.views.issue_token", return_value="test-session-token")
    @patch("profiles.views.authenticate", return_value=(SimpleNamespace(), SimpleNamespace(must_change_password=False)))
    def test_successful_login_keeps_existing_response_and_releases_budget(self, authenticate, issue, serialize):
        response = self.client.post("/api/auth/local/login", {"email": "ok@example.invalid", "password": "valid"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["accessToken"], "test-session-token")
        self.assertEqual(list(LoginBucket.objects.values_list("attempts", flat=True)), [0, 0])

    @patch("profiles.views._serialize_profile", return_value={"active": True})
    @patch("profiles.views.issue_token", return_value="test-session-token")
    @patch("profiles.views.authenticate", return_value=(SimpleNamespace(), SimpleNamespace(must_change_password=False)))
    def test_five_successful_logins_do_not_block_the_account(self, authenticate, issue, serialize):
        for _ in range(5):
            response = self.client.post("/api/auth/local/login", {"email": "ok@example.invalid", "password": "valid"}, content_type="application/json")
            self.assertEqual(response.status_code, 200)
        self.assertEqual(list(LoginBucket.objects.values_list("attempts", flat=True)), [0, 0])

    def test_non_post_does_not_consume_budget(self):
        self.assertEqual(self.client.get("/api/auth/local/login").status_code, 405)
        self.assertFalse(LoginBucket.objects.exists())

    @patch("profiles.views.authenticate", side_effect=LocalAuthenticationError("Identifiants incorrects."))
    def test_invalid_json_also_consumes_budget(self, authenticate):
        response = self.client.post("/api/auth/local/login", "{", content_type="application/json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(LoginBucket.objects.count(), 2)


@override_settings(GMAO_TRUSTED_PROXIES=[])
class ConcurrentLoginTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_creation_does_not_lose_ip_attempts(self):
        address = "192.0.2.40"

        def attempt(index):
            connections.close_all()
            try:
                return reserve_attempt(RequestFactory().post("/", REMOTE_ADDR=address), f"{index}@example.invalid").retry_after
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results, [0] * 8)
        self.assertEqual(LoginBucket.objects.get(key=bucket_key("ip", address)).attempts, 8)

    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_requests_share_last_pair_slot(self):
        now = timezone.now()
        address, email = "192.0.2.20", "parallel@example.invalid"
        LoginBucket.objects.create(key=bucket_key("ip", address), window_started=now, next_allowed=now)
        pair_key = bucket_key("pair", f"{address}\n{email}")
        LoginBucket.objects.create(key=pair_key, window_started=now, next_allowed=now, attempts=PAIR_LIMIT - 1)

        def attempt(_):
            connections.close_all()
            try:
                request = RequestFactory().post("/", REMOTE_ADDR=address)
                return reserve_attempt(request, email).retry_after
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count(0), 1)
        self.assertEqual(LoginBucket.objects.get(key=pair_key).attempts, PAIR_LIMIT)

    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_new_identifiers_share_last_ip_slot(self):
        now = timezone.now()
        address = "192.0.2.30"
        ip_key = bucket_key("ip", address)
        LoginBucket.objects.create(key=ip_key, window_started=now, next_allowed=now, attempts=IP_LIMIT - 1)

        def attempt(index):
            connections.close_all()
            try:
                return reserve_attempt(RequestFactory().post("/", REMOTE_ADDR=address), f"{index}@example.invalid").retry_after
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count(0), 1)
        self.assertEqual(LoginBucket.objects.get(key=ip_key).attempts, IP_LIMIT)
