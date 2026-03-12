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
# Auth0 config presence (para decidir defaults DRF en dev/tests)
# -----------------------------
# -----------------------------
# Auth0 config presence (para decidir defaults DRF en dev/tests)
# -----------------------------
AUTH0_ISSUER_BASE_URL = (
    os.getenv("AUTH0_ISSUER_BASE_URL")
    or os.getenv("OIDC_ISSUER")
    or ""
).rstrip("/")

AUTH0_AUDIENCE = (
    os.getenv("AUTH0_AUDIENCE")
    or os.getenv("OIDC_AUDIENCE")
    or ""
)

AUTH0_CONFIGURED = bool(AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE)

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

def _parse_origins(raw_origins: str) -> list[str]:
    parsed: list[str] = []
    for origin in (item.strip() for item in raw_origins.split(",") if item.strip()):
        p = urlparse(origin)
        if p.scheme not in {"http", "https"} or not p.hostname:
            raise RuntimeError(
                "HANDOVER_ALLOWED_ORIGINS only accepts absolute http(s) origins. "
                f"Invalid value: {origin!r}"
            )
        parsed.append(f"{p.scheme}://{p.netloc}")
    return parsed

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = _parse_origins(RAW_ALLOWED_ORIGINS)

# Regex útil para dev (localhost + LAN)
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https?:\/\/localhost(:\d+)?$",
    r"^https?:\/\/127\.0\.0\.1(:\d+)?$",
    r"^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$",
    r"^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$",
]

# ALLOWED_HOSTS: usa hosts de los origins + fallback
hosts_from_origins: list[str] = []
for origin in CORS_ALLOWED_ORIGINS:
    try:
        h = urlparse(origin).hostname
        if h:
            hosts_from_origins.append(h)
    except Exception:
        pass

ALLOWED_HOSTS = sorted(set(hosts_from_origins))

if DEBUG or RUNNING_TESTS:
    ALLOWED_HOSTS = sorted(set(ALLOWED_HOSTS + ["localhost", "127.0.0.1"]))

# Django test client usa "testserver"
if RUNNING_TESTS and "testserver" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS += ["testserver"]

LOCAL_IP = environ.get("LOCAL_IP")

# CSRF_TRUSTED_ORIGINS requiere esquema (http/https)
CSRF_TRUSTED_ORIGINS = [
    *CORS_ALLOWED_ORIGINS,
] + ([f"http://{LOCAL_IP}:8000"] if LOCAL_IP else [])

if DEBUG or RUNNING_TESTS:
    CSRF_TRUSTED_ORIGINS += [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

# En producción, evita arrancar sin orígenes (te protege de CORS/CSRF mal configurado)
if not DEBUG and not RUNNING_TESTS and not CORS_ALLOWED_ORIGINS:
    raise RuntimeError(
        "HANDOVER_ALLOWED_ORIGINS is required in production (set allowed https origins)."
    )

if not DEBUG and not RUNNING_TESTS and not ALLOWED_HOSTS:
    raise RuntimeError(
        "ALLOWED_HOSTS resolved empty in production. Set HANDOVER_ALLOWED_ORIGINS with public client domains."
    )

# ✅ Dev: permite llamadas por LAN (web/móvil) usando LOCAL_IP
if DEBUG and LOCAL_IP:
    # Permite Expo/Metro en LAN (dev)
    lan_origins = [
        f"http://{LOCAL_IP}:19006",  # Expo (legacy)
        f"http://{LOCAL_IP}:8081",   # Expo web dev server (tu caso)
        f"http://{LOCAL_IP}:3000",
    ]
    for o in lan_origins:
        if o not in CORS_ALLOWED_ORIGINS:
            CORS_ALLOWED_ORIGINS.append(o)

    # Permite requests con Host header = LOCAL_IP (evita DisallowedHost)
    if LOCAL_IP not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(LOCAL_IP)

    # CSRF trusted para el backend en LAN
    csrf_lan = f"http://{LOCAL_IP}:8000"
    if csrf_lan not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(csrf_lan)

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

# ✅ DRF defaults:
# - TESTS: AllowAny para que CI no dependa de Auth0 ni headers
# - DEV sin Auth0 config: AllowAny para que puedas probar local sin bloquearte
# - PROD (o dev con Auth0): Auth0 + IsAuthenticated
if RUNNING_TESTS or (DEBUG and not AUTH0_CONFIGURED):
    REST_FRAMEWORK = {
        "DEFAULT_AUTHENTICATION_CLASSES": [],
        "DEFAULT_PERMISSION_CLASSES": [
            "rest_framework.permissions.AllowAny",
        ],
    }
else:
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
# Por defecto: true (hardening). En DEBUG/TESTS: siempre OFF para no romper dev/local.
ENABLE_SSL_REDIRECT = os.getenv("ENABLE_SSL_REDIRECT", "true").lower() == "true"
if DEBUG or RUNNING_TESTS:
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
# CSP (formato django-csp >= 4.0)
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
            *tuple(
                origin for origin in CORS_ALLOWED_ORIGINS
                if origin.startswith("https://")
            ),
        ),
    }
}

# -----------------------------
# Auditoría
# -----------------------------
AUDIT_RETENTION_DAYS = int(os.getenv("AUDIT_RETENTION_DAYS", "180"))
AUDIT_HASH_SECRET = os.getenv("AUDIT_HASH_SECRET") or SECRET_KEY
HANDOVER_BUNDLE_RETENTION_DAYS = max(int(os.getenv("HANDOVER_BUNDLE_RETENTION_DAYS", "30")), 1)
HANDOVER_TECHNICAL_RETENTION_DAYS = max(int(os.getenv("HANDOVER_TECHNICAL_RETENTION_DAYS", "30")), 1)
HANDOVER_BUNDLE_ENCRYPTION_KEY = (os.getenv("HANDOVER_BUNDLE_ENCRYPTION_KEY") or "").strip()

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

