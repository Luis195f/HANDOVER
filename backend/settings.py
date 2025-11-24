from pathlib import Path
import os
from os import environ

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-placeholder")
DEBUG = True

HANDOVER_PRIVATE_KEY_PATH = os.getenv("HANDOVER_PRIVATE_KEY_PATH")
HANDOVER_PUBLIC_KEY_PATH = os.getenv("HANDOVER_PUBLIC_KEY_PATH")
HANDOVER_SIGNATURE_DISABLED = os.getenv("HANDOVER_SIGNATURE_DISABLED", "false")

OIDC_ISSUER = os.environ.get("OIDC_ISSUER")
OIDC_AUDIENCE = os.environ.get("OIDC_AUDIENCE")
OIDC_JWKS_URI = os.environ.get("OIDC_JWKS_URI")

ALLOWED_HOSTS: list[str] = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
allowed_origins = os.environ.get("ALLOWED_ORIGINS")
if allowed_origins:
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOWED_ORIGINS = [origin.strip() for origin in allowed_origins.split(",") if origin.strip()]

LOCAL_IP = environ.get("LOCAL_IP")
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
] + ([f"http://{LOCAL_IP}:8000"] if LOCAL_IP else [])

INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "backend.api",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "backend.authentication.JwtAuthenticationMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
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
    },
]

WSGI_APPLICATION = "backend.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": os.environ.get("DJANGO_DB_ENGINE", "django.db.backends.sqlite3"),
        "NAME": os.environ.get("DJANGO_DB_NAME", BASE_DIR / "db.sqlite3"),
    }
}

SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "false").lower() == "true"
SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

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

SENTRY_DSN = os.environ.get("SENTRY_DSN")

LOGGING_HANDLERS = ["error_file"] + (["sentry"] if SENTRY_DSN else [])

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "remove_personal": {
            "()": "backend.logging.RemovePersonalDataFilter",
        },
    },
    "handlers": {
        "error_file": {
            "level": "ERROR",
            "class": "logging.FileHandler",
            "filename": str(os.environ.get("ERROR_LOG_FILE", BASE_DIR / "error.log")),
            "filters": ["remove_personal"],
        },
        "sentry": {
            "level": "ERROR",
            "class": "sentry_sdk.integrations.logging.EventHandler",
            "filters": ["remove_personal"],
        },
    },
    "loggers": {
        "django": {
            "handlers": LOGGING_HANDLERS,
            "level": "ERROR",
            "propagate": True,
            "filters": ["remove_personal"],
        },
        "handover": {
            "handlers": LOGGING_HANDLERS,
            "level": "ERROR",
            "propagate": False,
            "filters": ["remove_personal"],
        },
    },
}

if not SENTRY_DSN:
    LOGGING["handlers"].pop("sentry", None)

REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "backend.exceptions.custom_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "error_log": "30/min",
    },
}
