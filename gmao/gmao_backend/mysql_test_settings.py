"""Isolated MySQL CI service, never the Aiven production configuration."""
from .settings import *  # noqa: F403

if os.environ.get("GMAO_MYSQL_TESTS") != "1":
    raise RuntimeError("Ces paramètres sont réservés aux tests MySQL explicites.")

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "HOST": "127.0.0.1",
        "PORT": "3306",
        "NAME": "gmao_ci",
        "USER": "root",
        "PASSWORD": "mysql-ci-only-password",
        "OPTIONS": {"charset": "utf8mb4"},
    },
}
