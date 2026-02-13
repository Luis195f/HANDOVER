import os
from types import SimpleNamespace

import pytest


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")


def _ensure_django_setup() -> None:
    import django
    from django.apps import apps

    if not apps.ready:
        django.setup()


_ensure_django_setup()

from django.conf import settings
if "testserver" not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, "testserver", "localhost", "127.0.0.1"]


@pytest.fixture()
def db():
    """Compat fixture when pytest-django is unavailable in local/dev environments."""
    return None


@pytest.fixture()
def client():
    from django.test import Client

    return Client()


@pytest.fixture()
def api_client():
    """DRF APIClient authenticated without requiring DB fixtures."""
    from rest_framework.test import APIClient

    c = APIClient()
    c.force_authenticate(user=SimpleNamespace(is_authenticated=True))
    return c
