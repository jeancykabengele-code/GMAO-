import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from check_availability import request_frontend, request_json


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; object-src 'none'",
            )
            body = b"<!doctype html><title>GMAO</title>"
        elif self.path == "/health":
            self.send_response(200)
            body = json.dumps({"status": "UP"}).encode()
        elif self.path == "/health/database" and self.headers.get("Authorization") == "Bearer test-token":
            self.send_response(200)
            body = json.dumps({"status": "UP", "database": "UP", "responseTimeMs": 1}).encode()
        else:
            self.send_response(401)
            body = b"{}"
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class AvailabilityChecksTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_frontend_requires_expected_csp(self):
        result = request_frontend(self.base_url + "/", timeout=2, max_seconds=1)
        self.assertTrue(result.ok)

    def test_api_requires_up_status(self):
        result = request_json("api", self.base_url + "/health", timeout=2, max_seconds=1)
        self.assertTrue(result.ok)

    def test_api_fails_when_latency_threshold_is_exceeded(self):
        result = request_json("api", self.base_url + "/health", timeout=2, max_seconds=0)
        self.assertFalse(result.ok)
        self.assertIn("latence", result.detail)

    def test_database_probe_sends_bearer_token(self):
        result = request_json(
            "database",
            self.base_url + "/health/database",
            timeout=2,
            max_seconds=1,
            token="test-token",
        )
        self.assertTrue(result.ok)

    def test_database_probe_rejects_wrong_token(self):
        result = request_json(
            "database",
            self.base_url + "/health/database",
            timeout=2,
            max_seconds=1,
            token="wrong-token",
        )
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
