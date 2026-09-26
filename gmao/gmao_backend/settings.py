import os
from pathlib import Path
from tempfile import gettempdir



BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [value.strip() for value in os.getenv(name, default).split(",") if value.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-development-only")
if not DEBUG and SECRET_KEY == "django-insecure-development-only":
    raise RuntimeError("DJANGO_SECRET_KEY est requis lorsque DJANGO_DEBUG=false.")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
if render_hostname := os.getenv("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_hostname)

INSTALLED_APPS = [
    "profiles",
    "login_guard",
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

if os.getenv("GMAO_DATABASE_ENGINE") == "mysql":
    mysql_ca_path = os.getenv("AIVEN_MYSQL_CA_PATH")
    mysql_ca_pem = os.getenv("AIVEN_MYSQL_CA_PEM")
    if not mysql_ca_path and mysql_ca_pem:
        ca_file = Path(gettempdir()) / "aiven-mysql-ca.pem"
        ca_file.write_text(mysql_ca_pem.replace("\\n", "\n"), encoding="utf-8")
        mysql_ca_path = str(ca_file)
    if not mysql_ca_path:
        raise RuntimeError("AIVEN_MYSQL_CA_PATH ou AIVEN_MYSQL_CA_PEM est requis pour MySQL.")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.mysql",
            "NAME": os.getenv("AIVEN_MYSQL_DATABASE", "defaultdb"),
            "USER": os.getenv("AIVEN_MYSQL_USER", "avnadmin"),
            "PASSWORD": os.environ["AIVEN_MYSQL_PASSWORD"],
            "HOST": os.environ["AIVEN_MYSQL_HOST"],
            "PORT": os.getenv("AIVEN_MYSQL_PORT", "3306"),
            "CONN_MAX_AGE": 0,
            "OPTIONS": {"charset": "utf8mb4", "ssl": {"ca": mysql_ca_path, "check_hostname": True}},
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

FRONTEND_ORIGINS = env_list(
    "FRONTEND_ORIGINS",
    "http://localhost:4200,http://127.0.0.1:4200",
)
GMAO_LOCAL_TOKEN_MAX_AGE = int(os.getenv("GMAO_LOCAL_TOKEN_MAX_AGE", "43200"))
# Dedicated monitoring secret; an empty value disables the database probe.
GMAO_HEALTH_TOKEN = os.getenv("GMAO_HEALTH_TOKEN", "").strip()
# Only Render's public Cloudflare ingress may supply the client address.
GMAO_LOGIN_TRUST_RENDER_PROXY = env_bool("RENDER", False)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
X_FRAME_OPTIONS = "DENY"
