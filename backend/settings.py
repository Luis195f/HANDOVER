import os
import sys
from os import environ
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Carga .env (tu ruta actual está OK)
ENV_PATH = BASE_DIR / "backend" / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)

# -----------------------------
# Flags de entorno
# -----------------------------
RUNNING_TESTS = (
    "test" in sys.argv
    or "pytest" in sys.argv
    or os.environ.get("PYTEST_CURRENT_TEST") is not None
)

SECRET_KEY = os.environ.get("SECRET_KEY")

# DEBUG controlable por env (default True para dev)
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() == "true"

HANDOVER_PRIVATE_KEY_PATH = os.getenv("HANDOVER_PRIVATE_KEY_PATH")
HANDOVER_PUBLIC_KEY_PATH = os.getenv("HANDOVER_PUBLIC_KEY_PATH")
HANDOVER_SIGNATURE_DISABLED = os.getenv("HANDOVER_SIGNATURE_DISABLED", "false").lower() == "true"

# -----------------------------
# Hosts / CORS / CSRF
# -----------------------------
RAW_ALLOWED_ORIGINS = os.getenv("HANDOVER_ALLOWED_ORIGINS", "").strip()

# Fallback dev-friendly (no te rompe nada)
DEFAULT_DEV_ORIGINS = (
    "http://localhost:19006,"
    "http://localhost:3000,"
    "http://127.0.0.1:19006,"
    "http://127.0.0.1:3000"
)

if not RAW_ALLOWED_ORIGINS and DEBUG:
    RAW_ALLOWED_ORIGINS = DEFAULT_DEV_ORIGINS

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [o.strip() for o in RAW_ALLOWED_ORIGINS.split(",") if o.strip()]

# Regex útil para dev (manténlo)
CORS_ALLOWED_ORIGIN_REGEXES = [r"^https?:\/\/localhost(:\d+)?$"]

# ALLOWED_HOSTS: usa hosts de los origins + fallback
hosts_from_origins: list[str] = []
for origin in CORS_ALLOWED_ORIGINS:
    try:
        h = urlparse(origin).hostname
        if h:
            hosts_from_origins.append(h)
    except Exception:
        pass

ALLOWED_HOSTS = sorted(set(hosts_from_origins + ["localhost", "127.0.0.1"]))

# Django test client usa "testserver"
if RUNNING_TESTS and "testserver" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS += ["testserver"]

LOCAL_IP = environ.get("LOCAL_IP")

# CSRF_TRUSTED_ORIGINS requiere esquema (http/https)
CSRF_TRUSTED_ORIGINS = [
    *CORS_ALLOWED_ORIGINS,
    "http://localhost:8000",
    "http://127.0.0.1:8000",
] + ([f"http://{LOCAL_IP}:8000"] if LOCAL_IP else [])

# En producción, evita arrancar sin orígenes (te protege de CORS/CSRF mal configurado)
if not DEBUG and not RUNNING_TESTS and not CORS_ALLOWED_ORIGINS:
    raise RuntimeError(
        "HANDOVER_ALLOWED_ORIGINS is required in production (set allowed https origins)."
    )

# -----------------------------
# Secret key
# -----------------------------
if not SECRET_KEY:
    if DEBUG or RUNNING_TESTS:
        SECRET_KEY = "django-insecure-placeholder"
    else:
        raise RuntimeError("SECRET_KEY is required in production.")

# -----------------------------
# Apps / DRF
# -----------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "csp",
    "rest_framework",
    "backend.api",
    "backend.audit",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "backend.security.auth.Auth0JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "csp.middleware.CSPMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "backend.audit.middleware.AuditRequestMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "backend.wsgi.application"

# -----------------------------
# DB
# -----------------------------
DATABASES = {
    "default": {
        "ENGINE": os.environ.get("DJANGO_DB_ENGINE", "django.db.backends.sqlite3"),
        "NAME": os.environ.get("DJANGO_DB_NAME", BASE_DIR / "db.sqlite3"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# -----------------------------
# Seguridad (HTTPS / Cookies / HSTS)
# -----------------------------
# Por defecto: true (hardening). En TESTS: siempre OFF para evitar 301 del client HTTP de Django.
ENABLE_SSL_REDIRECT = os.getenv("ENABLE_SSL_REDIRECT", "true").lower() == "true"
if RUNNING_TESTS:
    ENABLE_SSL_REDIRECT = False

SECURE_SSL_REDIRECT = ENABLE_SSL_REDIRECT

SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000")) if ENABLE_SSL_REDIRECT else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = ENABLE_SSL_REDIRECT
SECURE_HSTS_PRELOAD = ENABLE_SSL_REDIRECT

# Si estás detrás de proxy (nginx) con X-Forwarded-Proto
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if ENABLE_SSL_REDIRECT else None

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True

SESSION_COOKIE_SECURE = ENABLE_SSL_REDIRECT
CSRF_COOKIE_SECURE = ENABLE_SSL_REDIRECT

X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

# -----------------------------
# CSP (mantengo tu dict + compatibilidad django-csp)
# -----------------------------
CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        "default-src": ("'self'",),
        "script-src": ("'self'", "https://cdn.jsdelivr.net"),
        "style-src": ("'self'", "https://fonts.googleapis.com"),
        "img-src": ("'self'", "data:"),
        "font-src": ("'self'", "https://fonts.gstatic.com"),
        "connect-src": (
            "'self'",
            *tuple(origin for origin in CORS_ALLOWED_ORIGINS if origin.startswith("https://")),
        ),
    }
}

# Compatibilidad estándar con django-csp (no rompe tu dict)
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'", "https://cdn.jsdelivr.net")
CSP_STYLE_SRC = ("'self'", "https://fonts.googleapis.com")
CSP_IMG_SRC = ("'self'", "data:")
CSP_FONT_SRC = ("'self'", "https://fonts.gstatic.com")
CSP_CONNECT_SRC = (
    "'self'",
    *tuple(origin for origin in CORS_ALLOWED_ORIGINS if origin.startswith("https://")),
)

# -----------------------------
# Auditoría
# -----------------------------
AUDIT_RETENTION_DAYS = int(os.getenv("AUDIT_RETENTION_DAYS", "180"))
AUDIT_HASH_SECRET = os.getenv("AUDIT_HASH_SECRET") or SECRET_KEY

# -----------------------------
# Logging
# -----------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"format": "%(message)s"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        },
    },
    "loggers": {
        "audit": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
}
