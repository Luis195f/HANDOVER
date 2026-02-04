# MVP Demo / Piloto (5–7 min)

> **Objetivo**: demostrar flujo clínico SBAR, offline queue, auditoría y FHIR con datos sintéticos.

## Requisitos

- Node 20 + pnpm
- Python 3.11+ (Django)
- Datos **sintéticos** únicamente (sin PHI/PII real)

## Setup rápido (local)

```bash
pnpm -w install
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

En otra terminal:

```bash
pnpm expo start
```

### Variables de entorno de ejemplo (sin secretos)

```bash
# Backend (Django/FastAPI)
export HANDOVER_ALLOWED_ORIGINS="http://localhost"
export HANDOVER_FHIR_VALIDATION_MODE=off

# Frontend
export EXPO_PUBLIC_API_BASE_URL="http://localhost:8000"
export EXPO_PUBLIC_SESSION_IDLE_MINUTES=15
export EXPO_PUBLIC_SESSION_HARD_MINUTES=30
```

## Dataset sintético

Los bundles FHIR de demo están en `demo/fhir-bundles/`:

- `case-medical.json`
- `case-postop.json`
- `case-oncology-acute.json`
- `case-geriatrics.json`

Cargar un bundle (requiere token válido si el backend tiene JWT activo):

```bash
curl -X POST http://localhost:8000/api/fhir/transaction \
  -H "Content-Type: application/fhir+json" \
  -H "Authorization: Bearer <TOKEN_DEMO>" \
  --data-binary @demo/fhir-bundles/case-medical.json
```

## Guion demo (5–7 min)

1. **Login** con usuario de demo.
2. **Crear handover SBAR**: abrir un paciente del listado, completar Situation/Background/Assessment/Recommendation.
3. **Adjuntar nota dummy**: usar el adjunto de archivo o nota breve (sin datos reales).
4. **Offline → encolar → online → sync**:
   - Desactiva conectividad (modo avión o deshabilitar red).
   - Guarda el handover y verifica que queda en cola offline.
   - Reactiva conectividad y abre `Sync Center` para sincronizar.
5. **Auditoría**:
   - Abrir pantalla de auditoría y mostrar eventos con hash/tamaño (sin PHI).

## Validación rápida de SBAR IA (opcional)

Con el backend de IA activo:

```bash
curl -X POST http://localhost:8000/ai/summarize-sbar \
  -H "Content-Type: application/json" \
  -d '{"language":"es","free_text":"Dolor leve, sin incidencias.","context":{"vitals":"TA 120/70"}}'
```

La respuesta incluye advertencia de asistente (no diagnóstico/prescripción) en `full_text`.
