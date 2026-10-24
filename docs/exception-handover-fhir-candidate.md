# C11 — contrato FHIR candidato del relevo por excepciones

Estado: **candidato local, no activado**. No existe envío desde `UnitExceptionHandover`,
capability piloto nueva ni recurso productivo adicional en `HANDOFF_FHIR_CAPABILITY_MATRIX`.
La base `https://example.org/fhir/StructureDefinition/...` de `src/lib/fhir-profiles.ts`
es demostrativa, y el namespace local de procedencia `https://handover.app/fhir/...`
no acredita gobernanza institucional. No se declara un `meta.profile` propio hasta
resolver esa decisión. `productiveFhirResources` sigue vacío.

| Necesidad | Evidencia fuente | Recurso/campo candidato | Identidad y referencias | Comprobación local |
|---|---|---|---|---|
| Grupo y unidad | `ExceptionHandoverContext`, miembros paciente/unidad y clasificaciones C06 | `Group.identifier`, `member.entity`, extensión local de unidad por miembro | hash de contexto/revisión; `Patient` local por miembro | clave de grupo recalculada; referencias resueltas |
| Transferencia y recepción | eventos `outgoing_transfer` e `incoming_attestation` vinculados por `acknowledgesKey` | dos `Communication`, `sent`, `sender`, categoría y extensión de vínculo; `Composition.author/attester` | `idempotencyKey` original; `Practitioner` local por actor registrado | actores distintos; contexto, fecha y vínculo exigidos |
| A, B y C | `critical_check_back`/`critical_escalated`, `brief_review`, `unchanged_group_review` de C06 | `Communication` por evento; C tiene sujeto `Group`, no una evolución individual | identificador de evento; sujeto `Patient` o `Group` | `assessHandoffClosure` conserva requisitos por paciente y revisión colectiva |
| R y pendientes | `reviewRequirements` y eventos `r_resolved`/`r_transferred` | `Task` de intención `proposal`, `for` paciente, `authoredOn`, estado de fuente en extensiones; comunicación del evento | clave contexto/revisión/paciente/fuente | no convierte un owner textual en profesional identificado |
| Resumen y procedencia | texto aportado explícitamente y metadata C08 opcional | `Composition.section`; `Observation` del resumen solo si existe texto, con extensión C08 reutilizada | hash del contenido, hora de transferencia y `Group` | hash coincidente; aceptación IA requerida si se declara origen IA |

El constructor puro `buildExceptionHandoverFhirCandidate` exige un cierre ordinario
completo A/B/C/R, transferencia saliente y recepción de ese mismo contexto. Rechaza
contextos alterados, actores contradictorios, claves de evento conflictivas y resumen
con procedencia discordante. No modifica el original. Los IDs, `fullUrl`, referencias,
`Bundle.identifier` y timestamps derivan de datos ya registrados, sin reloj de render
ni sustitución de la firma clínica/criptográfica C03. El Bundle es una transacción
**candidata**, no se entrega al sender ni a la cola C04. No crea AuditEvent:
auditoría técnica y recepción clínica son contratos distintos.

`Group` es necesario para el colectivo C y la vista multiunidad; no representa
una identidad clínica nueva ni autorización global. Las unidades proceden del
ámbito de la vista C06, **demo**. Los actores proceden de eventos C06, también demo;
el constructor no verifica JWT ni habilita su uso no-demo. La evidencia textual
del resumen no existe en todos los estados C06: sin texto explícito no se crea
`Observation` ni se atribuye autoría/procedencia. Borradores legacy sin vínculo
de contexto no acreditan cierre ordinario. El modo degradado no tiene mapeo
candidato y se rechaza, sin alterar su contrato local.

`validateBundle` sigue siendo la entrada individual de producción, usada por
`postBundle` en modo estricto: un `subject` colectivo no relaja su comprobación.
Solo `validateExceptionHandoverCandidate`, invocado explícitamente por código
local y por la fixture C11 de `validate:fhir`, admite el sujeto `Group`. Exige
que cada referencia interna coincida exactamente con un `entry.fullUrl` UUID
único y que los miembros del grupo sean exactamente los pacientes del bundle.
`request.url` conserva el tipo de recurso de la operación POST; ningún vínculo
depende de que el servidor conserve `resource.id`.

Ambas entradas comprueban estructura básica de Bundle/Composition/Observation,
unicidad y resolución local de referencias; las pruebas comprueban además los
campos de `Group`, `Communication` y `Task`. Los validadores del repositorio usan
schema genérico para esos tres tipos y no prueban sus invariantes R4 completas,
perfiles externos, terminología ni aceptación por servidor. La estructura candidata
sigue las definiciones [Group](https://hl7.org/fhir/R4/group-definitions.html),
[Communication](https://hl7.org/fhir/R4/communication-definitions.html),
[Task](https://hl7.org/fhir/R4/task-definitions.html) y
[Composition](https://hl7.org/fhir/R4/composition.html) de R4. C11V y gobernanza
institucional siguen pendientes; `EXTERNAL-INTEGRATION=NOT_VERIFIED`.

Precondiciones preservadas: firma/cardinalidad C03; reintentos C04; scope C05;
contexto/revisión C06; procedencia por campo C08. C07 permanece PARTIAL, purga
histórica NOT_VERIFIED y C19A BLOCKED. El fallo operativo Nightly Backups por
`RCLONE_CONFIG_BASE64` ausente no se corrige en C11. No hay validación clínica.
