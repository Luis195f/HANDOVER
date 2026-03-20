# ICEA ETL read endpoint (Bundle clinico persistido)

> Estado revisado el 2026-03-09. Este endpoint si esta implementado y testeado. Su rol es servir el Bundle clinico persistido desde HANDOVER a un consumidor ETL autorizado; no depende del exito del webhook o del bridge ICEA+ para responder.

## 1) Source of truth real

`GET /api/handover/{bundle_id}` devuelve `bundle_json` desde `HandoverBundleRecord`.

Eso deja tres propiedades utiles para piloto:

1. el ETL lee la copia clinica persistida por HANDOVER;
2. la lectura no queda bloqueada por `IceaOutboundEvent` o `IceaBridgeRequest`;
3. un fallo ICEA+ no elimina la fuente ETL del handover ya aceptado.

El endpoint ETL sigue sin cambiar su contrato por el envelope contextual ICEA+: si el Bundle persistido ya trae `Observation/clinical-context`, ese contenido viaja como parte del FHIR original y puede ser reutilizado por el bridge, pero `GET /api/handover/{bundle_id}` no agrega ni transforma un payload paralelo.

Implementacion:

- `backend/api/views.py::HandoverEtlReadView`
- `backend/api/icea_transaction.py`
- `backend/api/models.py::HandoverBundleRecord`

Tests:

- `backend/api/tests/test_handover_etl_read.py`
- `backend/api/tests/test_icea_transaction.py`

## 2) Contrato HTTP

```http
GET /api/handover/{bundle_id}
Accept: application/fhir+json
Authorization: Bearer <s2s-token>
```

Respuestas respaldadas por tests:

- `200 OK`
- `304 Not Modified`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`

Cabeceras:

```http
Content-Type: application/fhir+json
ETag: W/"<sha256>"
Cache-Control: private, max-age=60
```

## 3) AuthN/AuthZ real

El endpoint exige:

- Bearer token;
- `gty = client-credentials`;
- rol `service_etl` o `admin`;
- scope `icea:etl:read` o `handover:etl:read`.

Esto esta probado en:

- `backend/api/tests/test_handover_etl_read.py`

## 4) Relacion con la transaccion clinica

Cuando `POST /api/fhir/transaction` termina con exito:

- se resuelve un `request_id`;
- se persiste `HandoverBundleRecord` por `request_id`;
- se guarda `bundle_id`, `patient_id`, `unit_id`, `bundle_json`, `expires_at`;
- luego se disparan side effects ICEA.

Orden respaldado:

1. outbox ICEA
2. persistencia ETL
3. snapshot pipeline
4. bridge analitico

Evidencia:

- `backend/api/tests/test_icea_transaction.py`

## 5) Idempotencia y cache

- La persistencia local del Bundle es idempotente por `request_id`.
- El endpoint ETL soporta `ETag` para `304 Not Modified`.
- El repo prueba tambien lectura repetida estable.

Limitacion:

- si el cliente cambia el `request_id`, HANDOVER interpreta una nueva operacion legitima.

## 6) Logging y PHI

Evidencia disponible:

- los tests validan que el flujo cubierto no vuelque Bearer ni `patient_id` sensible en logs de duplicado;
- el endpoint devuelve PHI solo al servicio autorizado.

Lo que debe quedar dicho:

- este endpoint si devuelve datos clinicos por diseno;
- la seguridad no depende solo del codigo, sino tambien de TLS, custodia de credenciales y despliegue del consumidor ETL.

## 7) Limites del endpoint

- Es un endpoint de lectura puntual por `bundle_id`, no un bulk export.
- No reemplaza un data pipeline completo ni un lago de datos.
- No consulta directamente ICEA+ para devolver el Bundle original.

## 8) Riesgo residual

El mayor riesgo residual no es de consistencia local, sino de operacion: una credencial S2S mal gestionada expone PHI. Por eso este endpoint debe mantenerse limitado a tokens de servicio con `client_credentials`, scopes acotados y TLS extremo a extremo.
