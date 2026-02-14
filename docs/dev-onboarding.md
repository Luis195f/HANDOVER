# Guía de onboarding para desarrollo local

## Requisitos
- Node 20 + pnpm.
- Python 3.10+.

## Backend (Django/DRF)
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

## Frontend (Expo)
```bash
pnpm install
expo start
```

## Cómo apuntar frontend al backend
- Define la URL base API del backend en variables `EXPO_PUBLIC_*` del cliente (p. ej. `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000/api`).
- En emulador/dispositivo físico, sustituye `localhost` por la IP de tu máquina cuando corresponda.

## Tests locales
Backend:
```bash
pytest --ds=backend.settings
pytest --cov=backend
```

Frontend (si aplica en tu flujo):
```bash
pnpm vitest run --reporter=verbose
```
