# Integracion ICEA+ service-to-service

## Resumen del flujo real

Tras un `POST /api/fhir/transaction` exitoso, HANDOVER:

1. confirma primero la transaccion clinica contra FHIR;
2. genera un payload tecnico minimo para ICEA+;
3. persiste un evento en `IceaOutboundEvent`;
4. intenta la entrega S2S de forma best-effort y desacoplada.

Si ICEA+ falla, la transaccion clinica **no se revierte**. El outbox queda auditable y recuperable mediante reintentos o `flush_icea_outbox`.

## Capa dedicada ICEA

El contrato S2S queda encapsulado en:

- `backend/api/icea_client.py`: firma HMAC, JSON canonico, headers, validacion de configuracion, parseo de respuesta, errores tipados y politica de retryable status codes.
- `backend/api/icea.py`: construccion del payload tecnico desde el Bundle FHIR, persistencia del outbox y orquestacion de entrega/reintentos.

## Variables de entorno

```env
ICEA_WEBHOOK_ENABLED=true
ICEA_WEBHOOK_URL=https://icea.example/api/v1/pipeline/ingest/
ICEA_WEBHOOK_SECRET=<shared-secret>
ICEA_WEBHOOK_TIMEOUT_MS=2500
ICEA_WEBHOOK_RETRY_MAX=5
ICEA_WEBHOOK_ANTI_REPLAY=false
ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS=300
ICEA_WEBHOOK_RETRYABLE_STATUS_CODES=408,409,425,429,500,502,503,504
```

## Validaciones de configuracion

Cuando `ICEA_WEBHOOK_ENABLED=true`, HANDOVER exige:

- `ICEA_WEBHOOK_URL` presente.
- `ICEA_WEBHOOK_SECRET` presente y con longitud minima razonable.
- HTTPS obligatorio fuera de `DEBUG` y tests.

Si la configuracion es invalida, el guardado clinico sigue adelante, pero el outbox queda en `retry` o `failed` con `last_error` explicito para recovery posterior.

## Payload enviado a ICEA+

Payload minimo:

```json
{
  "bundleId": "bundle-tx-001",
  "patientId": "pat-001",
  "unitId": "icu-a",
  "timestamp": "2026-03-07T12:00:00Z",
  "requestId": "tx-icea-001",
  "source": "HANDOVER"
}
```

Campos opcionales cuando existen en el Bundle:

```json
{
  "encounterId": "enc-001",
  "compositionId": "comp-001",
  "bundleIdentifier": "bundle-tx-001"
}
```

## Serializacion y firma

HANDOVER serializa el body con JSON canonico:

- `sort_keys=True`
- `separators=(",", ":")`
- UTF-8

Headers S2S:

```http
Content-Type: application/json
Idempotency-Key: <requestId>
X-ICEA-Signature: sha256=<hexdigest>
```

Si `ICEA_WEBHOOK_ANTI_REPLAY=true`, se anaden tambien:

```http
X-ICEA-Timestamp: <epochSeconds>
X-ICEA-Nonce: <uuid>
```

En ese modo la firma se calcula sobre:

```text
timestamp + "." + nonce + "." + raw_body
```

## Outbox local y estados

Modelo: `backend/api/models.py::IceaOutboundEvent`

Campos relevantes:

- `request_id`: identificador local unico de la operacion.
- `idempotency_key`: valor enviado en header; hoy coincide con `request_id`.
- `status`: `queued`, `retry`, `delivered`, `failed`.
- `attempts`: numero de intentos HTTP reales.
- `last_error`: ultimo error sanitizado.
- `last_http_status`: ultimo status HTTP recibido.
- `created_at`: creacion del evento.
- `last_attempt_at`: ultimo intento de entrega.
- `next_retry_at`: siguiente intento planificado.
- `delivered_at`: confirmacion de entrega 2xx.

Semantica:

- `queued`: pendiente inicial o listo para envio.
- `retry`: fallo recuperable o bloqueo temporal de configuracion.
- `delivered`: ICEA+ respondio 2xx.
- `failed`: fallo terminal; requiere `flush_icea_outbox --force` o reproceso explicito.

## Politica de reintentos

- Backoff exponencial local: 30s, 60s, 120s... hasta 30 min maximo.
- Status retryables por defecto: `408, 409, 425, 429, 500, 502, 503, 504`.
- Errores de transporte `httpx` tambien se consideran retryables.
- Los errores no retryables dejan el evento en `failed`.

Comando operativo:

```bash
python manage.py flush_icea_outbox --limit 100
python manage.py flush_icea_outbox --force --limit 100
```

`--force` incluye eventos en `failed`.

## Idempotencia y deduplicacion

Reglas actuales:

- La deduplicacion local del outbox se hace por `request_id` unico.
- El mismo valor se reutiliza como `Idempotency-Key` hacia ICEA+.
- Si llega el mismo `request_id` otra vez, HANDOVER no crea un segundo evento outbox ni vuelve a disparar la entrega ICEA.
- ICEA+ debe deduplicar por `Idempotency-Key` en receptor.

## Errores tipados en la capa cliente

`backend/api/icea_client.py` usa errores tipados:

- `IceaClientConfigurationError`
- `IceaTransportError`
- `IceaHTTPStatusError`

Eso permite distinguir:

- error de configuracion local,
- error de red/transporte,
- rechazo HTTP de ICEA+.

## Observabilidad y auditoria segura

HANDOVER no registra:

- PHI del Bundle clinico,
- payload crudo a ICEA+,
- secretos compartidos,
- tokens.

Los logs usan `safe_icea_event_summary(...)` y exponen solo:

- `request_id`
- `idempotency_key`
- hashes truncados de `bundle_id`, `patient_id`, `unit_id`
- `status`, `attempts`, `last_http_status`, `next_retry_at`
- detalle sanitizado del error

## Recovery path

1. revisar eventos `retry` o `failed` en `IceaOutboundEvent`;
2. corregir configuracion o disponibilidad del receptor;
3. ejecutar `flush_icea_outbox`;
4. usar `--force` si el evento ya quedo en `failed`.

## Garantia de no bloqueo clinico

`POST /api/fhir/transaction` mantiene esta regla:

- solo si FHIR responde con exito se persiste el Bundle y se encola ICEA;
- cualquier problema de ICEA se maneja fuera del guardado clinico;
- el error ICEA nunca bloquea ni revierte la transaccion clinica ya aceptada.
