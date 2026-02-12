# backend/api/tests/conftest.py
import pytest


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
