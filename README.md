# Backend Django

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


