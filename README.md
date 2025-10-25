# Backend Django

## Guía rápida

1. Copia `.env.example` a `.env` y ajusta las variables necesarias:
   ```bash
   cp .env.example .env
   # edita EXPO_PUBLIC_API_BASE_URL si tu backend corre en otra IP
   ```
2. Inicia el backend de Django:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py runserver 0.0.0.0:8000
   ```
3. Levanta el frontend móvil con Expo:
   ```bash
   pnpm install
   pnpm expo start -c
   ```
4. Verifica conectividad haciendo `GET` a `http://127.0.0.1:8000/api/ping` (o la IP que definas).

## Requisitos
- Python 3.10/3.11/3.12

## Desarrollo local (Windows)
```bash
python -m venv .venv
. .venv/Scripts/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

CI

GitHub Actions usa Python 3.10/3.11/3.12.

Despliegue (Render/Railway)

Procfile + runtime.txt
ENV:

DJANGO_SETTINGS_MODULE=backend.settings

SECRET_KEY=...

ALLOWED_HOSTS=*
## Desarrollo local y móvil
```bash
# Windows
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```
- Abre desde el móvil en la misma Wi-Fi: http://TU_IP_LOCAL:8000/
- Endpoints: `/` y `/api/ping`


