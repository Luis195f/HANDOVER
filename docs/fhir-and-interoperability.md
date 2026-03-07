# Interoperabilidad FHIR

## Recursos y mapeo
- Recursos utilizados: `Observation`, `Composition`, `MedicationStatement`, `Condition`, `Procedure`, `DocumentReference`, entre otros según el formulario.
- `src/lib/fhir-map.ts` convierte los datos del formulario en bundles FHIR listos para envío. Cada entrada se transforma a recursos individuales y se empaqueta en un `Bundle` con referencias coherentes.
- `src/lib/fhir-terminology.ts` centraliza el mapping mínimo viable NNN, sus `system` locales y el estado de los perfiles específicos de interoperabilidad.

## Minimum Viable Mapping

| Concepto de enfermería | Recurso FHIR destino | Campo FHIR exacto | Sistema de codificación | Notas | Profile URI |
| --- | --- | --- | --- | --- | --- |
| NANDA-I diagnóstico de enfermería | `Condition` | `Condition.code` | `urn:handover:terminology:NANDA-I` | Se usa `Condition.code.coding` cuando `dxNursingStructured[].system = "NANDA"`. Si no hay URI licenciada externa, se mantiene namespace propio `urn:handover:*`. El texto legacy en `dxNursing` sigue siendo opcional y compatible hacia atrás. | no especificado |
| NIC intervención de enfermería | `Procedure` | `Procedure.code` | `urn:handover:terminology:NIC` | El repositorio ya construye `Procedure`; se conserva esa decisión para no romper bundles existentes. La codificación NIC convive con el código local de tipo de tratamiento en el mismo `CodeableConcept`. | no especificado |
| NOC resultado esperado/medido | `Observation` | `Observation.code` | `urn:handover:terminology:NOC` | `Observation.category` usa `http://terminology.hl7.org/CodeSystem/observation-category#outcome`. Los componentes `baseline`, `target` y `current` siguen usando el namespace local `urn:handover-pro:noc-score` por compatibilidad. | no especificado |

## Diagnóstico de enfermería NANDA-I (canal primario)
- `dxNursingStructured` se mapea como canal primario a `Condition.code.coding` cuando el sistema es `NANDA`.
- `coding.system` usa por defecto `urn:handover:terminology:NANDA-I` para evitar declarar una URI oficial sin licencia de terminología.
- `dxNursing` se mantiene como texto legado derivado/optativo para compatibilidad hacia atrás.
- Si se adquiere licencia oficial NANDA-I, reemplaza la constante en [fhir-terminology.ts](/C:/h/HANDOVER/src/lib/fhir-terminology.ts) y conserva el resto del mapeo.
- Nota de licencia: sin licencia completa, el sistema debe usar texto sugerido y codificación interna/URN; la codificación oficial solo debe habilitarse con el contrato de uso correspondiente.

## Intervenciones NIC
- `treatments[]` sigue siendo opcional y se mapea a `Procedure` para mantener el flujo y el bundle actuales.
- Cuando `treatments[].code.system = "NIC"`, la codificación NIC se añade en `Procedure.code.coding` con `urn:handover:terminology:NIC`.
- El código interno de tipo de tratamiento (`urn:handover-pro:care:treatment-type`) se conserva en paralelo para no romper lógica existente de composición, referencias y tests.
- No se declara un profile URI específico para NIC: queda explícitamente como `no especificado` hasta disponer de uno real.

## Resultados esperados NOC (captura rápida)
- `outcomes[]` es opcional y permite registrar de 1 a 3 resultados con `nocCode`, `nocDisplay`, `baseline`, `target` y `current` opcional.
- Cada resultado se mapea a `Observation` con `category.code = "outcome"`.
- `Observation.code.coding` preserva el código y display NOC usando `urn:handover:terminology:NOC`.
- `baseline`, `target` y `current` se serializan en `Observation.component.valueInteger` con códigos explícitos (`baseline`, `target`, `current`) para mantener trazabilidad clínica y compatibilidad.
- No se declara un profile URI específico para NOC: queda explícitamente como `no especificado` hasta disponer de uno real.

## Cliente y configuración
- Define `FHIR_BASE_URL` o `EXPO_PUBLIC_FHIR_BASE_URL` en `.env`/`app.json` (`expo.extra`) para apuntar al servidor FHIR.
- El cliente en `src/lib/fhir-client.ts` agrega cabeceras de idempotencia, maneja respuestas `OperationOutcome` y reintentos seguros.
- `HANDOVER_FHIR_VALIDATION_MODE` controla la validación de bundles:
  - `"off"`: el backend reenviará sin validar.
  - `"remote"`: se invoca `$validate` en el servidor FHIR y se bloquea la entrega ante errores `error`/`fatal`.

## Configuración de voz e IA clínica
- `EXPO_PUBLIC_API_BASE_URL`/`API_BASE_URL`: base URL única del backend Django/DRF.
- STT usa el endpoint único `POST /api/ai/transcribe` (multipart con `file` y opcional `language`).
- Migración de configuración STT: usa `API_BASE_URL` y construye `${API_BASE_URL}/api/ai/transcribe`.
- SBAR IA usa `AI_BACKEND_BASE_URL` (por defecto `${API_BASE_URL}/api`) en `/ai/summarize-sbar`.
- `AI_SBAR_BASE_URL` (configurado vía `AI_SBAR_URL` o `EXPO_PUBLIC_AI_SBAR_URL`): backend especializado en refinado SBAR (`/api/sbar/refine`).
- `AI_SBAR_API_KEY`: token opcional para autenticar las llamadas al refinado SBAR.
- `OPENAI_API_KEY`: clave del proveedor de IA (se configura en el backend para Whisper/SBAR).
- Limitaciones actuales:
  - El dictado y la grabación de audio solo están soportados en iOS/Android (en web se marca como no disponible).
  - Si no hay backend configurado, los módulos de STT/SBAR se desactivan sin bloquear el flujo (preparados para proveedor externo).
  - La subida de audio a FHIR depende de `API_BASE_URL` y el endpoint `/upload/audio-to-fhir`.

Para obtener estas credenciales:
- Solicita al equipo de infraestructura los endpoints y claves del entorno clínico (staging/producción).
- En desarrollo, puedes usar servicios locales o un túnel HTTPS (por ejemplo, `ngrok`) para exponer el backend Django/DRF.

## Validación y envío offline de bundles
- `HANDOVER_FHIR_VALIDATION_MODE` admite `off`, `local` y `remote` para controlar la validación previa al envío.
  - `off`: se encola y se envía sin validaciones adicionales.
  - `local`: aplica las reglas locales (`validateFHIRBundle` + `validateResource`) antes de encolar o reenviar.
  - `remote`: tras la validación local se llama a `$validate` en el servidor FHIR por cada recurso del `Bundle` y el envío se bloquea si hay issues `error`/`fatal`.
- En modo offline la app encripta los bundles pendientes en la cola usando AES (`encryptPayload` / `decryptPayload`) y los procesa en orden FIFO cuando vuelve la conectividad, respetando los reintentos con backoff y deteniendo los reenvíos si la validación remota responde con `422`.
- Configura la URL de `$validate` y de transacciones con `FHIR_BASE_URL`/`EXPO_PUBLIC_FHIR_BASE_URL`; el endpoint de bundles transaccionales del backend queda expuesto en `/api/fhir/transaction` y reenvía el bundle al servidor FHIR con `Prefer: return=representation` y token Bearer.

## Validación de códigos SNOMED/LOINC/NNN
- Los catálogos locales (`src/lib/codes.ts`, `src/lib/fhir-terminology.ts` y `src/catalogs/diagnosisCodes.ts`) se consolidan en conjuntos en memoria para validar códigos SNOMED CT, LOINC y los `system` internos NNN sin llamadas externas.
- La función `validateTerminologyCode` consulta `/ValueSet/$validate-code` del servidor FHIR cuando `HANDOVER_FHIR_VALIDATION_MODE=remote` y el código no está en las listas locales. Se envían los parámetros `system`, `code` y `display` y se interpreta `result=true` como éxito.
- Los resultados se cachean por sesión para evitar invocar el endpoint repetidamente y se muestra al usuario un mensaje claro si el servidor devuelve `result=false` o si no hay conectividad.
- Los formularios de diagnósticos bloquean el envío cuando el código SNOMED ingresado no existe (local o remotamente) y sugieren escoger uno del autocompletado.

## Firma digital y trazabilidad
- Cuando se configuran `HANDOVER_PRIVATE_KEY_PATH` y `HANDOVER_PUBLIC_KEY_PATH`, el backend añade `bundle.signature` (FHIR Signature con ECDSA + SHA-256) antes de enviar el `Bundle` al servidor FHIR. Si el cliente ya envía `signature`, se valida y se rechaza con `400` si la verificación falla.
- El hash SHA-256 del `Bundle` (sin el nodo `signature`) se guarda en la tabla `HandoverSignatureAudit` junto con `user_id`, `signed_at` y el valor base64 de la firma, lo que permite auditar quién firmó cada relevo.
- Para entornos de desarrollo se puede definir `HANDOVER_SIGNATURE_DISABLED=true` y evitar la firma/validación criptográfica.

## Bundles y idempotencia
- Los bundles generados incluyen UUID y se pueden reenviar sin duplicar gracias a las cabeceras configuradas en el cliente y al soporte de la cola offline.
- Para depurar esquemas FHIR se puede usar `scripts/validate-fhir.ts` y el comando `pnpm validate:fhir`.

## Ejemplo STT (endpoint único DRF)

```bash
curl -X POST "$API_BASE_URL/api/ai/transcribe" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@./demo-audio.m4a;type=audio/m4a" \
  -F "language=es"
```

