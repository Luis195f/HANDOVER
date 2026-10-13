# C04 — intención durable de transacción FHIR

`HandoverForm → fhir-map → queue → sync.ts → fhir-client → BundleView → FHIR` es la ruta canónica. `postBundle` envía a `API_BASE_URL/api/fhir/transaction`, no a `FHIR_BASE_URL/Bundle`; las lecturas FHIR conservan su base independiente. `src/lib/sync.ts::enqueueBundle` y `tx_queue` son compatibilidad legacy, no prueba del recorrido activo. La cola cifra el Bundle, fija `Idempotency-Key` al identificador estable y no hace retry HTTP interno (`retryOn: []`).

En el E2E sintético, el interceptor demo permite el POST transaccional a `https://demo.local/api/fhir/transaction` hacia el transporte simulado. En demo normal (`EXPO_PUBLIC_E2E` ausente o `false`), el interceptor responde al mismo POST con un `Bundle` sintético `transaction-response`, sin red externa; una respuesta genérica `{ok:true}` no confirma la cola.

## Contrato local

`HandoverBundleRecord` tiene unicidad de `request_id` y `bundle_id`. Tras auth, verificación de firma y autorización por unidad, el backend compara SHA-256 del Bundle normalizado sin la firma criptográfica de transporte reconocida, pero con la rúbrica clínica y todos los campos clínicos, y HMAC de paciente/unidad. Dos firmas de transporte válidas del mismo contenido comparten hash lógico; una firma inválida se rechaza antes de aceptar la intención. Diferente contenido o ámbito con la misma clave produce `409 idempotency_conflict`, sin POST FHIR. La intención cifrada se confirma en DB como `pending` antes de cualquier POST; fallo de DB produce `503 transaction_intent_unavailable`, sin envío. Inmediatamente antes del POST pasa a `unknown` durable: tras un reinicio, ni `pending` ni `unknown` prueban ausencia de efecto.

La garantía de replay requiere que el cliente reutilice su `Idempotency-Key`; el formulario y la cola canónica lo hacen. La cola solo retira el elemento tras un `Bundle` de tipo `transaction-response`; un 2xx pendiente o sin confirmación permanece en cola. Un cliente sin clave estable no puede reclamar deduplicación entre peticiones nuevas. Un replay ya registrado no depende de repetir `$validate` remoto, pero sí vuelve a pasar auth, firma y ámbito de unidad.

| Estado | Evidencia | Respuesta/reintento |
| --- | --- | --- |
| `pending` | Intención durable, envío no acreditado | Reconciliar; nunca reenviar automáticamente |
| `unknown` | Timeout, desconexión, 5xx, respuesta no interpretable o envío en curso | `503 transaction_unknown`; cola conservada, sin nuevo POST upstream |
| `succeeded` | `Bundle`/`transaction-response` 2xx o evidencia positiva de reconciliación | Respuesta cifrada reutilizada, sin nuevo POST clínico; efectos locales pendientes se reanudan |
| `failed` | Rechazo definitivo 4xx, salvo 408/429 | Respuesta cifrada reutilizada; 409/412 no equivalen a entrega |

La respuesta upstream y el Bundle local se cifran con el mecanismo existente. ETL, dashboard y bridge solo leen `succeeded`. La transición a `succeeded` persiste atómicamente `effects_pending`; auditoría local de cierre, efectos ICEA y `AuditEvent` FHIR registran progreso por etapa. Un replay confirmado recupera etapas pendientes sin reenviar la transacción clínica. La reclamación durable evita trabajo simultáneo sobre el mismo registro y permite recuperar una reclamación abandonada tras cinco minutos. Outbox, snapshot y bridge usan sus claves existentes para deduplicar registros locales; las funciones que absorben errores se verifican contra esos registros antes de marcar ICEA completo. La auditoría mantiene metadatos técnicos minimizados. El `AuditEvent` FHIR externo puede repetirse si se pierde su confirmación: no se afirma exactly-once externo. La respuesta de reconciliación positiva es un `transaction-response` mínimo con la referencia `Composition` verificada, no una copia inventada de la respuesta original.

Al vencer la retención, el comando de expurgo elimina Bundle, respuesta y ámbitos en claro y conserva en el mismo registro una lápida técnica HMAC para bloquear reenvíos. Una lápida `unknown` ya no puede reconciliarse automáticamente. Los registros previos a C04 migran como `succeeded`, pero carecen de hash/resultado de origen; una repetición no verificable nunca provoca nuevo envío. La continuidad de `SECRET_KEY` es necesaria para localizar lápidas HMAC tras rotaciones; debe tratarse operativamente antes de rotar claves.

## Matriz de recursos

| Recurso | Identidad emitida | Operación actual | Reconciliación y colisión |
| --- | --- | --- | --- |
| `Patient`, `Practitioner`, `Encounter` | `id` estable e identificadores disponibles | POST normal | El servidor puede reasignar ID; no se interpreta su presencia aislada como éxito del relevo |
| `Composition` | `id` estable; la cola añade `identifier=urn:handover:transaction-composition|<bundle-id>` a una única Composition sin identificar | POST normal | Solo una búsqueda exacta positiva, `total=1`, con capacidad `Composition.identifier` anunciada permite recuperar el éxito de una transacción atómica; cero o varios resultados son inciertos |
| `Observation`, `Condition`, `DetectedIssue`, `Procedure`, `MedicationStatement`, `MedicationAdministration`, `DeviceUseStatement`, `Device`, `DocumentReference` | IDs derivados por mapper o explícitos | POST normal | No hay criterio universal de identidad clínica; no se usan para inferir ausencia ni se sobrescriben por PUT |

No se añade `ifNoneExist` masivo ni PUT: su semántica de colisión podría unir relevos distintos y su soporte no está verificado. El tag backend `urn:handover:tx` permanece intacto; el hash de entrada se toma antes de añadirlo. La firma clínica y verificación criptográfica C03 no se modifican. La lectura de `CapabilityStatement` y búsqueda exacta solo se usa para reconciliación positiva; ni una búsqueda vacía ni una falla autorizan reenvío. El soporte efectivo del servidor FHIR, la atomicidad observada y las búsquedas no están verificados sin sandbox: `EXTERNAL-INTEGRATION=NOT_VERIFIED`; no se afirma exactly-once upstream.

Referencia de estándar: [FHIR R4 Composition.identifier](https://hl7.org/fhir/R4/composition.html) y [transacciones y capacidades condicionales](https://hl7.org/fhir/R4/http.html).
