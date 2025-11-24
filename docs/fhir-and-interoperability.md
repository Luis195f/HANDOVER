# Interoperabilidad FHIR

## Recursos y mapeo
- Recursos utilizados: `Observation`, `Composition`, `MedicationStatement`, `MedicationRequest`, `Condition`, `Procedure`, `DiagnosticReport`, entre otros según el formulario.
- `src/lib/fhir-map.ts` convierte los datos del formulario en bundles FHIR listos para envío. Cada entrada se transforma a recursos individuales y se empaqueta en un `Bundle` con referencias coherentes.

## Cliente y configuración
- Define `FHIR_BASE_URL` o `EXPO_PUBLIC_FHIR_BASE` en `.env`/`app.json` (`expo.extra`) para apuntar al servidor FHIR.
- El cliente en `src/lib/fhir-client.ts` agrega cabeceras de idempotencia, maneja respuestas `OperationOutcome` y reintentos seguros.
- `HANDOVER_FHIR_VALIDATION_MODE` controla la validación de bundles:
  - `"off"`: el backend reenviará sin validar.
  - `"remote"`: se invoca `$validate` en el servidor FHIR y se bloquea la entrega ante errores `error`/`fatal`.

## Validación y envío offline de bundles
- `HANDOVER_FHIR_VALIDATION_MODE` admite `off`, `local` y `remote` para controlar la validación previa al envío.
  - `off`: se encola y se envía sin validaciones adicionales.
  - `local`: aplica las reglas locales (`validateFHIRBundle` + `validateResource`) antes de encolar o reenviar.
  - `remote`: tras la validación local se llama a `$validate` en el servidor FHIR por cada recurso del `Bundle` y el envío se
    bloquea si hay issues `error`/`fatal`.
- En modo offline la app encripta los bundles pendientes en la cola usando AES (`encryptPayload` / `decryptPayload`) y los
  procesa en orden FIFO cuando vuelve la conectividad, respetando los reintentos con backoff y deteniendo los reenvíos si la
  validación remota responde con `422`.
- Configura la URL de `$validate` y de transacciones con `FHIR_BASE_URL`/`EXPO_PUBLIC_FHIR_BASE_URL`; el endpoint de bundles
  transaccionales del backend queda expuesto en `/api/fhir/transaction` y reenvía el bundle al servidor FHIR con
  `Prefer: return=representation` y token Bearer.

## Firma digital y trazabilidad
- Cuando se configuran `HANDOVER_PRIVATE_KEY_PATH` y `HANDOVER_PUBLIC_KEY_PATH`, el backend añade `bundle.signature` (FHIR Signature con ECDSA + SHA-256) antes de enviar el `Bundle` al servidor FHIR. Si el cliente ya envía `signature`, se valida y se rechaza con `400` si la verificación falla.
- El hash SHA-256 del `Bundle` (sin el nodo `signature`) se guarda en la tabla `HandoverSignatureAudit` junto con `user_id`, `signed_at` y el valor base64 de la firma, lo que permite auditar quién firmó cada relevo.
- Para entornos de desarrollo se puede definir `HANDOVER_SIGNATURE_DISABLED=true` y evitar la firma/validación criptográfica.

## Bundles y idempotencia
- Los bundles generados incluyen UUID y se pueden reenviar sin duplicar gracias a las cabeceras configuradas en el cliente y al soporte de la cola offline.
- Para depurar esquemas FHIR se puede usar `scripts/validate-fhir.ts` y el comando `pnpm validate:fhir`.
