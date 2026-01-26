from pathlib import Path
import os
from os import environ
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
from dotenv import load_dotenv
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-placeholder")
DEBUG = True

HANDOVER_PRIVATE_KEY_PATH = os.getenv("HANDOVER_PRIVATE_KEY_PATH")
HANDOVER_PUBLIC_KEY_PATH = os.getenv("HANDOVER_PUBLIC_KEY_PATH")
HANDOVER_SIGNATURE_DISABLED = os.getenv("HANDOVER_SIGNATURE_DISABLED", "false")

RAW_ALLOWED_ORIGINS = os.getenv("HANDOVER_ALLOWED_ORIGINS", "")
ALLOWED_HOSTS: list[str] = [
    urlparse(origin).hostname or origin
    for origin in RAW_ALLOWED_ORIGINS.split(",")
    if origin
]
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = RAW_ALLOWED_ORIGINS.split(",") if RAW_ALLOWED_ORIGINS else []
CORS_ALLOWED_ORIGIN_REGEXES = [r"^https?:\/\/localhost(:\d+)?$"]

LOCAL_IP = environ.get("LOCAL_IP")
CSRF_TRUSTED_ORIGINS = [
    *CORS_ALLOWED_ORIGINS,
    "http://localhost:8000",
    "http://127.0.0.1:8000",
] + ([f"http://{LOCAL_IP}:8000"] if LOCAL_IP else [])

INSTALLED_APPS = [
    "corsheaders",
    "csp",
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
    "csp.middleware.CSPMiddleware",
    "django.middleware.security.SecurityMiddleware",
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

SECURE_SSL_REDIRECT = os.getenv("ENABLE_SSL_REDIRECT", "true") == "true"
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        "default-src": ("'self'",),
        "script-src": ("'self'", "https://cdn.jsdelivr.net"),
        "style-src": ("'self'", "https://fonts.googleapis.com"),
        "img-src": ("'self'", "data:"),
        "font-src": ("'self'", "https://fonts.gstatic.com"),
        "connect-src": ("'self'",),
    }
}
