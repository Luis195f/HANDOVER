# backend/api/tests/conftest.py
import os

import pytest

try:
    import pytest_django  # type: ignore  # noqa: F401
except Exception:  # pragma: no cover - dependency guard
    pytest.skip("pytest-django is required for backend API tests", allow_module_level=True)


def pytest_configure():
    # Asegura settings para pytest (evita "settings are not configured")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")


@pytest.fixture()
def api_client(db):
    """
    DRF APIClient autenticado (user real en DB).
    Esto evita 403/401 por falta de auth cuando sólo quieres probar permisos/validación.
    """
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient

    User = get_user_model()
    user = User.objects.create_user(username="testuser", password="testpass")

    c = APIClient()
    c.force_authenticate(user=user)
    return c
