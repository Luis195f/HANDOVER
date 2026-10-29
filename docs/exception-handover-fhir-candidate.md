# C11 — contrato FHIR candidato del relevo por excepciones

## C12 — cableado autenticado TEST_ENV, sin piloto

El backend crea un turno operativo con UUID persistido, unidad del ámbito autenticado,
periodo y descripción explícitos; el periodo no es su identidad. La creación se
deduplica por `operationId` y contenido. El creador es el profesional saliente; un
profesional distinto de la misma unidad puede seleccionar el registro y atestar la
recepción. El actor de cada evento se contrasta con el `sub` autenticado en el
backend. No se aceptan turnos fabricados sin confirmación del servidor ni `ALL` como
unidad. Esto no constituye una agenda institucional verificada.

`ExceptionHandoverShift` conserva estado y recibos cifrados con el mecanismo AES-GCM
existente, revisión optimista y caducidad máxima igual al menor plazo entre
`HANDOVER_BUNDLE_RETENTION_DAYS` y 30 días. La poda elimina turnos caducados y
referencias aceptadas vencidas; la lectura no renueva plazos. Una nueva sesión de
turno recupera solo referencias anteriores no caducadas de la misma unidad. La
aceptación exige un manifiesto congelado, transferencia saliente e identidad distinta
del receptor; el replay consulta el recibo por el mismo identificador antes de
reenviar. Una revisión obsoleta o contenido contradictorio se rechaza. Los pendientes
locales usan almacenamiento cifrado y se borran en la limpieza/logout C07, sin
Bearer token ni sender FHIR. Una respuesta incierta permanece pendiente y no acredita
aceptación compartida; el trabajo offline exige un turno previamente confirmado.

La transferencia R exige que el receptor introduzca un momento objetivo ISO 8601 con
zona; se conserva en el borrador y en el evento sin inferir plazos clínicos. No resuelve
la falta de fuente ni convierte R en B/C. La API exige conjuntamente `patients:read`
y `handover:write` en listado, creación, estado y recibos.

El hash del recibo usa JSON UTF-8 compacto con claves ordenadas por puntos de código
Unicode en todos los niveles, equivalente a `json.dumps(sort_keys=True,
separators=(',', ':'), ensure_ascii=False)` para el dominio admitido: enteros seguros,
strings, booleanos, null, arrays y objetos. La fixture compartida fija bytes y SHA-256;
la identidad de pendientes y recibos existentes no cambia.

Un `409 revision_conflict` u `operation_conflict` conserva la operación rechazada
cifrada como conflicto definitivo. La lectura recupera el estado autorizado, pero no
reenvía la aceptación ni descarta la edición local: el usuario debe revisar y
descartar explícitamente los cambios rechazados antes de continuar. Timeout/red
sigue pendiente y consulta primero el recibo. La contención SQLite transitoria se
reintenta acotadamente fuera de la transacción revertida; una revisión obsoleta
sigue siendo conflicto.

La poda de referencias vencidas usa actualización condicional por revisión y la
incrementa; una escritura basada en la revisión anterior no puede sobrescribirla.
La API tampoco admite reintroducir una referencia vencida. Los eventos y
borradores previamente autorizados de pacientes dados de alta o trasladados
permanecen históricos e inmutables; cualquier dato nuevo o cambio de borrador
exige pertenencia actual a la unidad. La lectura offline requiere una sesión
local vigente del mismo actor y unidad: conserva el trabajo pendiente cifrado,
separado del estado confirmado, y bloquea el cierre hasta su confirmación
compartida. Los conflictos no se mezclan con ese pendiente y requieren
reconciliación explícita. Una revocación remota no puede comprobarse sin
conexión; toda operación de servidor vuelve a exigir autorización efectiva.

La capability candidata depende de configuración **servidor** en `HANDOVER_DEPLOYMENT_MODE=test`
y `HANDOVER_EXCEPTION_TEST_RUNTIME=true`, además de identidad, permiso y unidad.
La capability piloto permanece `false` con razones explícitas: C11V, IdP, umbrales,
strict-mode y entorno institucional no verificados. Los datos actuales de
`PatientList` no transportan referencia y fecha fuente verificables: su clasificación
candidata es R, no B/C por defecto. El Bundle C11 se construye y valida localmente
antes de la recepción, sin envío clínico. Las pruebas TEST_ENV no acreditan fuente
clínica conectada, durabilidad en dispositivo ni activación institucional.

Estado: **candidato local, no activado**. No existe envío desde `UnitExceptionHandover`,
capability piloto nueva ni recurso productivo adicional en `HANDOFF_FHIR_CAPABILITY_MATRIX`.
La base `https://example.org/fhir/StructureDefinition/...` de `src/lib/fhir-profiles.ts`
es demostrativa, y el namespace local de procedencia `https://handover.app/fhir/...`
no acredita gobernanza institucional. No se declara un `meta.profile` propio hasta
resolver esa decisión. `productiveFhirResources` sigue vacío.

## C17 — estado candidato respaldado por fuentes

La vista demo de `PatientList` usa la clasificación candidata, no el campo `status`
prefijado de sus fixtures. Primera comparación sin referencia aceptada, ausencia de
fuente identificable, datos inválidos, cobertura distinta, contradicción, fuente
vencida o fecha futura llevan a **R**. **A** solo procede de una designación humana
explícita con motivo, actor y ámbito vigente; no se derivan nuevos umbrales de
MPAC/NEWS2. **B/C** comparan hashes del contenido de los campos cubiertos de una
fuente validada frente al último snapshot aceptado del mismo paciente y unidad:
**C no significa estabilidad clínica global**.

| Fuente candidata | Campos estructurados admitidos | Evidencia requerida | Estado del adaptador activo |
|---|---|---|---|
| Valoración directa | `observationLevel`, `activeRisks`, `risks`, `risksStructured` | referencia, paciente, unidad, fecha de observación, disponibilidad y cobertura válida | `PatientList` no recibe referencia/fecha verificables; R |
| Registro de observación | `vitals`, `oxygenTherapy` | los mismos vínculos; temperatura canónica y semántica de oxígeno existentes | la lista aporta `vitals`, pero no referencia/fecha; R |
| Plan vigente | `plan`, `pendingTasks`, `contingencyPlan` | registro identificado y vigente, no mero texto generado | la lista aporta tareas; falta referencia/fecha; R |
| Administración / incidencia | solo registro efectivo identificable | contrato del registro y vínculo paciente/unidad | sin adaptador verificable; si se requiere, R. Prescripción, tarea o flag no prueban administración/incidencia |

El snapshot v1 contiene ID determinista, paciente, unidad, turno y por fuente su
referencia, versión disponible, `observedAt`, cobertura, disponibilidad y hash del
contenido comparable; no duplica los valores/narrativas. El manifiesto congelado
ordena pacientes/unidades y vincula su hash a la transferencia saliente y a la
atestación entrante del mismo contexto/revisión. El receptor acepta explícitamente
**ese conjunto como referencia comparativa**; no certifica cada medición. Los
eventos C06 antiguos sin hash de manifiesto permanecen históricos, sin aceptación
retroactiva. Un cambio de contenido/contexto exige nueva transferencia y recepción.

La designación humana A se contrasta con el reloj de interacción, separado del
reloj sintético de valoración. La proyección comparable excluye `recordedAt`,
`issuedAt` y campos indefinidos del hash clínico; estos metadatos no acreditan una
medición. Al aceptar un turno B/C se conserva la referencia previa que lo clasifica;
la nueva referencia se selecciona desde el turno siguiente. La compactación
retiene la referencia más reciente y la operativa previa cuando sea necesaria
para el turno activo, por paciente y unidad, sujetas a caducidad.

El store cifrado C06 conserva referencias aceptadas por paciente/unidad entre
turnos, separadas de los eventos transitorios. La escritura debe confirmarse antes
de mostrar aceptación; el fallback web solo en memoria no acredita durabilidad.
La referencia caduca por defecto en un día (menos que el máximo backend de 30);
leerla no renueva la fecha y el store gestionado purga las vencidas al acceso. La
limpieza C07 existente cubre esta misma clave. Sin fuente ni baseline comprobable,
el recorrido real sigue en R aunque las pruebas sintéticas demuestren B/C. Ni la
vista demo ni este Bundle candidato activan piloto, runtime no-demo o egress FHIR.

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
