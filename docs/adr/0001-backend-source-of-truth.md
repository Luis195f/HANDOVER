# ADR-0001: Backend source of truth

- Estado: aceptado
- Fecha: 2026-03-31

## Contexto

HANDOVER tuvo un `main.py` histórico en la raíz durante la etapa en que coexistían piezas auxiliares previas a la consolidación del backend clínico. En esta rama, `git ls-files main.py` no devuelve entradas y no hay un `main.py` en la raíz del working tree; el historial Git además muestra su eliminación en el cambio que unificó los endpoints operativos en Django/DRF.

La ambigüedad residual más probable no está en el código activo sino en la interpretación documental y operativa: confundir la exportación web de `docker-compose.yml`, restos históricos de `main.py` o flujos manuales de desarrollo con un backend alternativo.

## Decisión

El backend operativo y única fuente de verdad de servidor en HANDOVER es Django + Django REST Framework.

Los entrypoints y evidencias operativas vigentes son:

- `manage.py`, que fija `DJANGO_SETTINGS_MODULE=backend.settings`
- `backend/api/urls.py`, que publica la API clínica y de soporte
- `Procfile`, que arranca `gunicorn backend.wsgi`
- `.github/workflows/django.yml`, que ejecuta migraciones y `pytest` sobre Django

En esta rama no hay `main.py` trackeado en la raíz y, por tanto, no debe interpretarse como entrypoint operativo actual. Si reaparece en el futuro para tooling, demos o utilidades, deberá quedar explícitamente fuera de la ruta clínica operativa o respaldado por un ADR posterior que reemplace esta decisión.

## Consecuencias

- No se debe documentar ni desplegar un backend paralelo dentro de HANDOVER.
- La topología web estática (`Dockerfile` + `docker-compose.yml`) no sustituye al backend Django; solo empaqueta la exportación web.
- Las guías de onboarding, deploy, CI y troubleshooting deben citar Django/DRF como backend operativo único.
- Cualquier referencia histórica a `main.py`, FastAPI o servicios auxiliares debe quedar marcada como legado o retirada, nunca como ruta vigente.
