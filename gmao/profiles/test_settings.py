import os
from pathlib import Path
import runpy
from unittest.mock import patch

from django.test import SimpleTestCase


SETTINGS_PATH = Path(__file__).resolve().parent.parent / "gmao_backend" / "settings.py"
TEST_SECRET = "settings-test-only-secret-never-use-in-production"


class DebugConfigurationTests(SimpleTestCase):
    def load_settings(self, environment):
        # Isolate configuration checks from developer and production variables.
        with patch.dict(os.environ, environment, clear=True):
            return runpy.run_path(str(SETTINGS_PATH))

    def test_missing_debug_defaults_to_secure_configuration(self):
        configuration = self.load_settings({"DJANGO_SECRET_KEY": TEST_SECRET})
        self.assertIs(configuration["DEBUG"], False)
        self.assertIs(configuration["SESSION_COOKIE_SECURE"], True)
        self.assertIs(configuration["CSRF_COOKIE_SECURE"], True)

    def test_explicit_false_keeps_debug_disabled(self):
        configuration = self.load_settings({"DJANGO_DEBUG": "false", "DJANGO_SECRET_KEY": TEST_SECRET})
        self.assertIs(configuration["DEBUG"], False)

    def test_missing_debug_and_secret_refuses_startup(self):
        with self.assertRaisesRegex(RuntimeError, "DJANGO_SECRET_KEY est requis"):
            self.load_settings({})

    def test_explicit_false_rejects_development_key(self):
        with self.assertRaisesRegex(RuntimeError, "DJANGO_SECRET_KEY est requis"):
            self.load_settings({"DJANGO_DEBUG": "false", "DJANGO_SECRET_KEY": "django-insecure-development-only"})

    def test_explicit_local_debug_allows_development_startup(self):
        configuration = self.load_settings({"DJANGO_DEBUG": "true"})
        self.assertIs(configuration["DEBUG"], True)
        self.assertIs(configuration["SESSION_COOKIE_SECURE"], False)
        self.assertIs(configuration["CSRF_COOKIE_SECURE"], False)
