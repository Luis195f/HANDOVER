# ICEA ETL read endpoint

## Source of truth actual

El endpoint `GET /api/handover/{bundle_id}` lee `HandoverBundleRecord` persistidos por HANDOVER tras una transaccion FHIR exitosa. No depende del outbox ICEA para responder.

Esto mantiene dos propiedades:

- la lectura ETL no queda bloqueada por la entrega S2S a ICEA+;
- la copia del Bundle usada por ETL se conserva aunque ICEA falle o quede en retry.

## Endpoint

```http
GET /api/handover/{bundle_id}
Accept: application/fhir+json
Authorization: Bearer <s2s-token>
```

## Requisitos AuthN/AuthZ

Se exige Bearer token de `client_credentials` y, ademas:

- `gty=client-credentials`
- role: `service_etl` o `admin`
- scope: `icea:etl:read` o `handover:etl:read`

## Respuestas

- `200 OK`: devuelve el Bundle FHIR almacenado.
- `304 Not Modified`: si `If-None-Match` coincide con el ETag.
- `401 Unauthorized`: token ausente, invalido o expirado.
- `403 Forbidden`: grant, rol o scope insuficiente.
- `404 Not Found`: `bundle_id` inexistente.

## ETag y cache

HANDOVER calcula el ETag con SHA-256 sobre el JSON canonico del `bundle_json` persistido.

Cabeceras de respuesta:

```http
Content-Type: application/fhir+json
ETag: W/"<sha256>"
Cache-Control: private, max-age=60
```

## Persistencia asociada al POST clinico

Cuando `POST /api/fhir/transaction` termina bien:

- se crea o reutiliza `HandoverBundleRecord` por `request_id`;
- se persiste `bundle_id`, `patient_id`, `unit_id`, `request_id`, `bundle_json`;
- se conserva `expires_at` y `encryption_metadata` para operacion y retencion.

La persistencia ETL es idempotente por `request_id` y queda separada del outbox ICEA.

## Relacion con el outbox ICEA

`HandoverBundleRecord` y `IceaOutboundEvent` cumplen roles distintos:

- `HandoverBundleRecord`: fuente de lectura ETL y retencion del Bundle fuente.
- `IceaOutboundEvent`: telemetria y recuperacion de la entrega S2S HANDOVER -> ICEA+.

Esto permite que un handover exitoso siga siendo legible por ETL aunque el webhook ICEA este en `retry` o `failed`.

## Seguridad operativa

- no registrar `Authorization` ni payloads clinicos crudos en logs;
- limitar el token S2S a lectura ETL;
- rotar credenciales de servicio;
- usar HTTPS extremo a extremo en entornos no test;
- mantener trazabilidad con `request_id` y `bundle_id` sin exponer PHI en observabilidad.

## Ejemplos

```bash
curl -i \
  -H "Authorization: Bearer ${S2S_TOKEN}" \
  -H "Accept: application/fhir+json" \
  "https://handover.example.com/api/handover/bundle-001"
```

```bash
ETAG='W/"abc123"'
curl -i \
  -H "Authorization: Bearer ${S2S_TOKEN}" \
  -H "If-None-Match: ${ETAG}" \
  "https://handover.example.com/api/handover/bundle-001"
```
