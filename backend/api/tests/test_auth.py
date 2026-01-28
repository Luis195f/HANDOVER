from django.test import TestCase

class AuthMiddlewareTests(TestCase):
    def test_placeholder(self):
        # TODO: reemplazar por tests reales:
        # - token faltante -> 401/403
        # - token inválido -> 401
        # - token válido -> 200 en endpoint protegido
        self.assertTrue(True)
