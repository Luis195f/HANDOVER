# Integracion ICEA+ webhook

## Resumen

Tras un `POST /api/fhir/transaction` exitoso, HANDOVER crea un evento técnico en outbox y dispara un `HTTP POST` best-effort hacia `ICEA_WEBHOOK_URL`. El guardado clínico en FHIR nunca se bloquea por fallos del webhook.

## Variables de entorno

```env
ICEA_WEBHOOK_ENABLED=true
ICEA_WEBHOOK_URL=https://icea.example/api/v1/pipeline/ingest/
ICEA_WEBHOOK_SECRET=<shared-secret>
ICEA_WEBHOOK_TIMEOUT_MS=2500
ICEA_WEBHOOK_RETRY_MAX=5
ICEA_WEBHOOK_ANTI_REPLAY=false
ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS=300
```

## Payload enviado

Payload mínimo:

```json
{
  "bundleId": "bundle-tx-001",
  "patientId": "pat-001",
  "unitId": "icu-a",
  "timestamp": "2026-03-07T12:00:00Z",
  "requestId": "tx-icea-001"
}
```

Campos opcionales que HANDOVER añade cuando están disponibles:

```json
{
  "encounterId": "enc-001",
  "compositionId": "comp-001",
  "bundleIdentifier": "bundle-tx-001",
  "source": "HANDOVER"
}
```

## Firma HMAC

HANDOVER serializa el body con JSON canónico (`sort_keys=True`, `separators=(",", ":")`) y firma el body crudo UTF-8.

Headers enviados:

```http
Content-Type: application/json
Idempotency-Key: <requestId>
X-ICEA-Signature: sha256=<hexdigest>
```

Si `ICEA_WEBHOOK_ANTI_REPLAY=true`, también envía:

```http
X-ICEA-Timestamp: <epochSeconds>
X-ICEA-Nonce: <uuid>
```

En ese modo la firma se calcula sobre:

```text
timestamp + "." + nonce + "." + raw_body
```

## Outbox y reintentos

- Modelo: `IceaOutboundEvent`
- Estados: `pending`, `sent`, `error`
- Idempotencia local: `request_id` único
- Reintentos: backoff exponencial con máximo `ICEA_WEBHOOK_RETRY_MAX`
- Flush manual: `python manage.py flush_icea_outbox`

## Verificacion en ICEA

Verificacion recomendada en el receptor:

1. Leer el body crudo exacto.
2. Si anti-replay está activo, validar ventana temporal y unicidad del nonce dentro de `ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS`.
3. Recalcular `HMAC-SHA256` con el secreto compartido.
4. Comparar con `X-ICEA-Signature` en tiempo constante.
5. Deduplicar por `Idempotency-Key`.

## Observabilidad

Los logs del emisor no incluyen PHI ni secretos. Solo registran `request_id`, hash de `bundleId`, estado, latencia y número de intentos.
