import os
from pathlib import Path



BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [value.strip() for value in os.getenv(name, default).split(",") if value.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-development-only")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
if render_hostname := os.getenv("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_hostname)

INSTALLED_APPS = [
    "profiles",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "gmao_backend.middleware.ApiCorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "gmao_backend.urls"
TEMPLATES = []
WSGI_APPLICATION = "gmao_backend.wsgi.application"
ASGI_APPLICATION = "gmao_backend.asgi.application"

if os.getenv("SUPABASE_DB_PASSWORD"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("SUPABASE_DB_NAME", "postgres"),
            "USER": os.getenv("SUPABASE_DB_USERNAME", "postgres.rgujwidwlqesukqwgnib"),
            "PASSWORD": os.environ["SUPABASE_DB_PASSWORD"],
            "HOST": os.getenv("SUPABASE_DB_HOST", "aws-0-eu-central-1.pooler.supabase.com"),
            "PORT": os.getenv("SUPABASE_DB_PORT", "5432"),
            # Supabase fournit deja le pool de sessions. Un second pool local
            # psycopg peut conserver une connexion distante fermee et bloquer
            # le chargement du profil. Django reutilise plutot une connexion
            # courte et la controle avant chaque requete.
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "sslmode": "require",
                "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "5")),
                "keepalives": 1,
                "keepalives_idle": 30,
                "keepalives_interval": 10,
                "keepalives_count": 3,
            },
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
APPEND_SLASH = False

SUPABASE_AUTH_URL = os.getenv("SUPABASE_AUTH_URL", "https://rgujwidwlqesukqwgnib.supabase.co")
SUPABASE_PUBLISHABLE_KEY = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_aenZtHUAj0SEUjBTgs2EBg_ZRpqzahr",
)
SUPABASE_AUTH_ISSUER = os.getenv("SUPABASE_AUTH_ISSUER", f"{SUPABASE_AUTH_URL}/auth/v1")
SUPABASE_JWKS_URL = os.getenv(
    "SUPABASE_JWKS_URL",
    f"{SUPABASE_AUTH_URL}/auth/v1/.well-known/jwks.json",
)
SUPABASE_AUTH_AUDIENCE = os.getenv("SUPABASE_AUTH_AUDIENCE", "authenticated")
FRONTEND_ORIGINS = env_list(
    "FRONTEND_ORIGINS",
    "http://localhost:4200,http://127.0.0.1:4200",
)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
X_FRAME_OPTIONS = "DENY"
