# C02: interpretación compartida de oxígeno para NEWS2

Base: `3c471ba9c7f61abb199ecd9439d47c27ce10c4bc`.
Estado: consolidación técnica local de NEWS2; pendiente de validación y revisión del PR.

`src/lib/oxygen.ts` expone `isSupplementalOxygen`, una función pura sobre
el tipo existente `OxygenTherapy`. Se comparte entre summary, ai-degrade,
handoverRisk, alerts, prefill y los cálculos NEWS2 del formulario, incluido el posterior al envío.

En `computeAlerts`, la terapia estructurada informativa prevalece sobre `vitals.o2`.
`resolveSupplementalOxygen` permite el fallback con ausencia, null, objeto vacío
o campos ausentes/blancos; aire ambiente o cantidades ambientales explícitas
lo anulan. El bloqueo FR sigue omitiendo
los signos antes de invocar alerts: disponer de oxígeno no restaura el cálculo.
No se cambia la regla NEWS2 ≥ 7 con riesgo activo ni las alertas independientes.

Prefill usa el último valor estructurado válido de cada magnitud mediante
`getTs` existente (effectiveDateTime, issued, meta.lastUpdated; primer elemento
en empate). Se admiten números finitos con `%` o `L/min`, las unidades emitidas
por `fhir-map/vitals.impl.ts`; code prevalece sobre unit y, si hay system,
debe ser UCUM. No se convierten unidades ni cadenas numéricas; cantidades sin
unidad/código admitido no son utilizables. Si existe FiO₂ o flujo utilizable,
el helper decide y el texto no puede contradecirlo. Sin valores utilizables,
se conserva literalmente la heurística textual anterior, con sus limitaciones.
La salida expresa `vitals.o2` como booleano cuando se procesan observaciones.
Se preservan las prioridades, el bloqueo FR y el fallback offline.

Para los adaptadores NEWS2 con ambos alias de temperatura, `tempC` es canónico:
`selectNews2Temperature` en `news2-input.ts` selecciona `tempC ?? temp` sin
conversiones, rangos nuevos ni selección por gravedad/fecha. MPAC, alerts y
el fallback calculado de patient-filters comparten esta selección. El parser
local de alerts admite `tempC=null` como ausencia; los schemas persistidos no
cambian. PatientList conserva ambos campos originales. FHIR/sync y adaptadores
con un único campo no se modifican. La suite usa normalización real de
PatientList y consumidores reales, con contradicciones, null, ausencia,
igualdad, rechazo de cadenas en alerts y comprobación de no mutación.

La lectura ACVPU usa `resolveAcvpu`, resolver puro exportado desde `fhir-map.ts`
y respaldado exclusivamente por su `AVPU_MAP` privado. No se expone el objeto,
no se copian equivalencias y no cambia ninguna salida FHIR. Reconoce letras,
códigos SNOMED y descripciones exactas del diccionario, normalizando únicamente
mayúsculas/minúsculas y espacios. Prefill lee code/display de coding, text y
valueString; un código con sistema explícito ajeno a SNOMED no se interpreta
como código SNOMED. La Observation se identifica por el LOINC existente o el
reconocimiento textual legacy de ACVPU/AVPU. Se conserva la selección temporal
existente: un valor desconocido posterior no recupera una observación anterior.
No hay reconocimiento por subcadenas de los valores ni conversión de desconocidos
a A/U. Si los valores reconocidos de la Observation seleccionada discrepan,
se detiene ese prefill y retorna la salida parcial segura ya existente, sin
conciencia elegida, NEWS2 ni prioridad; no se añade otro contrato o metadato.

El fixture UCI versionado con `Responds to voice` conserva el recurso original
y se interpreta como V: con FR 16, SpO₂ 94, T 39,1, PAS 120 y FC 111 sin oxígeno,
el total es 8, conciencia 3, anyThree verdadero, banda CRÍTICA y prioridad high.
Las pruebas cubren los cinco estados, representaciones, contradicciones
sintéticas, desconocidos, narrativas y el round-trip del mapeador real.
El grafo transitivo, incluidos imports dinámicos locales, no tiene una ruta
de `fhir-map.ts` a prefill: añadir prefill → fhir-map no introduce ese ciclo.

PatientList aplica `evaluateNews2Input` antes de invocar prioridad/MPAC. La unión
interna devuelve `calculated` con resultado, o `blocked` con código
`NEWS2_NOT_CALCULABLE` y razón `rr_requires_integer`, reutilizando
`createRrReviewGate`; no se añade otra validación ni se transforma la FR.
Una entrada bloqueada no contiene total, banda, anyThree, score ni prioridad.
La tarjeta muestra una única región accesible con el mensaje existente
«NEWS2 no calculable: verificar frecuencia respiratoria». Se conservan las
alertas independientes mediante la proyección `withoutNews2Vitals`; no se
invoca MPAC para esas entradas ni se inventa una prioridad low. Los conteos
de prioridad solo incluyen resultados calculados. Con ordenación por prioridad,
los bloqueados van después, en orden de entrada; sin ella se conserva el orden
original. El normalizador y la respuesta API no se mutan.

El ordenador legacy conserva `news2 > latestNews2.score > vitals`. Los dos
primeros son resultados independientes sin procedencia temporal verificable;
no se invalidan por FR decimal actual ni se afirma que cumplan el contrato
vigente o correspondan a las constantes mostradas. Su fuente se distingue
internamente como `news2` o `latestNews2`; solo la fuente `vitals` aplica el gate.
Los bloqueados van después de scores numéricos, manteniendo su orden relativo;
no equivalen a cero o riesgo bajo. La ausencia real de FR conserva el cálculo
anterior. No cambian `priority.ts`, reglas MPAC, schemas, API, FHIR o persistencia.
La suite CI cubre ambas precedencias, límites enteros, ausencia, orden mixto y
PatientList montado desde `/api/patients`, con alertas y consumidores reales.

El DTO interno de prefill transporta las cantidades reales en `oxygenTherapy`
y el indicador textual separado en `legacyOxygen`, manteniendo `vitals.o2`
por compatibilidad del DTO. Solo las cantidades inicializan React Hook Form.
No se inventan dispositivos ni cantidades; no se amplían schemas persistidos.
El booleano se conserva exclusivamente en un ref de sesión de HandoverForm.
Las entradas efímeras de alertas y riesgo usan un getter `o2` no enumerable,
separado del formulario: ni JSON ni spreads transportan ese getter. Las firmas
de los consumidores y los contratos FHIR/API no cambian. No se pasan estas
entradas efímeras a borradores, submit, resúmenes ni exportadores.
Se invalida antes de restaurar ambos recorridos de borradores, ante reset,
al cambiar paciente/ruta/prefill, al desmontar y en eventos de usuario
`change` de oxygenTherapy; `setValue` programático no simula una edición.
Las cantidades reales siguen el recorrido de persistencia/exportación existente.
La suite monta el formulario y cubre precedencia, edición, cambio de paciente,
restauración desde SecureStore, serialización, FHIR y contexto externo de IA.

Los resúmenes normal y mínimo aceptan `transientO2Fallback` únicamente en
opciones de ejecución. El adaptador determinista de UI propaga esa opción;
no se incorpora al handover, al resultado ni al argumento del proveedor externo.
Sin opción se mantiene el cálculo anterior. Solo varía el NEWS2 derivado en
los textos ya existentes. La memoización depende del fallback y una revisión
en memoria invalida sugerencias pendientes o respuestas anteriores a una
edición de oxígeno/reset. Se actualizan textos automáticos todavía reconocidos
por su fingerprint; no se sobrescriben silenciosamente textos históricos o
editados. Tras restaurar, una nueva generación usa los datos persistidos sin
fallback; su aceptación utiliza el recorrido existente de revisión humana.

El contexto de `ai-suggestions` resuelve `vitalSigns.onOxygen` con la misma
terapia y el mismo ref transitorio que el NEWS2 visible. Un objeto vacío permite
el fallback; las cantidades ambientales o aire ambiente explícitos prevalecen.
Solo se corrige el valor del campo ya existente: no se añaden campos al payload,
ni se envía el ref o su metadato. No cambian proveedor, prompts, gates ni egress.
La suite monta HandoverForm y usa el serializador real de ai-suggestions con
transporte simulado sin red real; comprueba la matriz de oxígeno y la
invalidación tras edición, restauración y cambio de paciente.

Las solicitudes de sugerencias capturan la revisión FR, la revisión de oxígeno
existente y un identificador de solicitud en memoria por sección (vitals o
diagnosis). Solo la solicitud vigente de cada sección puede publicar resultados,
cachearlos, mostrar errores o finalizar su carga. Carga y errores también son
independientes; cada componente recibe su estado con la interfaz existente.
El cambio de revisión limpia sugerencias, caché, errores y carga del contexto
anterior en ambas secciones. Una respuesta fuera de orden no sustituye la más
reciente de su misma sección; las peticiones de secciones distintas pueden
completar en cualquier orden. Las pruebas montadas controlan resolución/rechazo,
invalidación compartida y lectura de caché mientras el otro panel está pendiente,
con transporte simulado. Se conserva la duración de caché de 15 segundos.
No cambia el contrato externo.

Ausencia, null, objeto vacío, dispositivo vacío o espacios no indican oxígeno.
El dispositivo «aire ambiente» ignora mayúsculas y espacios redundantes.
Cualquier otro dispositivo no vacío, flujo > 0 o FiO₂ > 21 indica administración.
Flujo 0 y FiO₂ ≤ 21 no activan oxígeno por sí solos. Ante aire ambiente con
flujo positivo o FiO₂ > 21 prevalece el indicador objetivo, sin reescribir datos.

La corrección evita sumar +2 por la mera presencia de un objeto vacío o valores
ambientales. No altera la fórmula NEWS2, escalas, bandas, bloqueo FR, Braden,
prioridades, plantillas narrativas, privacidad ni auditoría. Los textos
derivados pueden reflejar el total corregido. El wrapper de riesgo conserva
su representación heredada null/NaN para componentes ausentes.

El mapper FHIR conserva FiO₂ y flujo medidos como Observation, incluso 21 % y
0 L/min, pero solo deriva un tratamiento nuevo de oxigenoterapia si
`isSupplementalOxygen` acredita administración real. Un `status: completed`
recibido explícitamente conserva su Procedure histórica, fechas y nota aunque
no haya indicadores de administración actual; no se confunde con el
`in-progress` añadido por defecto al mapear el formulario. Sin dispositivo no
se fabrica DeviceUseStatement. El booleano transitorio NEWS2 nunca se exporta
como tratamiento. Los tratamientos explícitos del handover conservan sus
estados mediante su mapeo independiente. Pruebas montadas cubren
prefill → formulario → envío simulado → bundle sin escritura externa.
No cambia terminología ni contrato persistido.

La matriz en `tests/screens/news2-input-contract.spec.tsx`, ya incluida en CI,
cubre pureza, contradicciones y paridad de resúmenes, riesgo y formulario con
SpO₂ 98 y 94, FR 16, temperatura 37, PAS 120, FC 110 y conciencia A:
sin oxígeno, totales 1 y 2; con oxígeno, 3 y 4. Conserva pruebas de FR y Braden.

## Inventario final de NEWS2

La búsqueda de `NEWS2`, `news2`, `computeNEWS2`, puntuaciones de componentes,
umbrales, bandas y oxígeno en `src`, `backend`, tests y documentos distingue
cálculo fisiológico de decisiones derivadas. La autoridad técnica de componentes,
total, `anyThree` y banda es `src/lib/news2.ts:86`; Scale 1, Scale 2 RCP y el
componente independiente +2 están descritos en
`docs/clinical-profiles-framework.md:198`. No se selecciona Scale 2 desde
prefill: se pasa explícitamente `scale2: false`.

| Archivo / punto | Función y dependencia | Clasificación y acción |
| --- | --- | --- |
| `src/lib/news2.ts:86` | `computeNEWS2`: RR, SpO₂, oxígeno, T, PAS, FC, ACVPU, total, `anyThree`, banda | Fuente canónica; sin cambios |
| `src/lib/news2-input.ts:17` | Gate FR entera, estado bloqueado y selección `tempC ?? temp` | Adaptador legítimo; sin fórmula ni cambios |
| `src/lib/oxygen.ts:4` | Evidencia estructurada y fallback transitorio | Adaptador compartido; sin fórmula ni cambios |
| `src/lib/prefill.ts:162` | FHIR → constantes, `acvpu` → `avpu`, Scale 1 → canónico → `priorityFromNEWS2` | Única fórmula duplicada eliminada; prioridad low/medium/high propia, conservada |
| `src/screens/QRScan.tsx:374` | Resultado prefill y aviso FR | Consumidor de UI; sin cálculo ni cambios |
| `src/screens/HandoverForm.tsx:1011,2160` | NEWS2 visible y alerta al enviar, ambos canónicos; gate FR y oxígeno transitorio | Consumidor directo; sin cambios en esta fase |
| `src/components/handover/VitalsSection.tsx` | Desglose y aviso FR del formulario | Consumidor de UI; sin fórmula ni cambios |
| `src/lib/summary.ts:298,344` | Resumen normal y narración breve desde canónico | Consumidor directo; etiquetas de banda, sin cambios |
| `src/lib/ai-degrade.ts:84` | Resumen mínimo offline desde canónico | Consumidor directo; umbral narrativo ≥5, sin cambios |
| `src/lib/alerts.ts:186,255` | Canónico y regla combinada NEWS2 ≥7 + riesgo; otras alertas independientes | Derivación legítima; sin cambios |
| `src/lib/alerts.ts:74` | `alertsFromData` acepta score precomputado | Compatibilidad; solo referencias en pruebas encontradas, sin cambios |
| `src/lib/mpac.ts:242,719` | Wrapper canónico y contribuciones MPAC por total/`anyThree` | Derivación legítima; reglas MPAC sin cambios |
| `src/lib/priority.ts:20`, `src/lib/priority-ui.ts:259` | Orden y presentación de prioridad MPAC con `news2Score` | Decisión downstream, no fórmula; sin cambios |
| `src/lib/scores/news2.ts:18` | Traduce nombres/null y desglose canónico | Wrapper legítimo; sin cambios |
| `src/lib/scores/handoverRisk.ts:14,54`, `src/lib/scores/riskRules.ts:24` | Wrapper de riesgo, Braden independiente y umbrales de riesgo configurados | Derivación legítima; sin cambios |
| `src/lib/patient-filters.ts:32,67` | `news2` > `latestNews2.score` > cálculo canónico desde `vitals`; orden estable de bloqueados | Compatibilidad legacy: scores precomputados sin procedencia temporal verificable; sin cambios |
| `src/lib/patientListData.ts:54`, `src/screens/PatientList.tsx:632` | API → normalizador sin score precomputado → gate FR → MPAC/alertas/UI | Consumidor activo; sin cambios |
| `src/lib/analytics.ts:39,56` | Agrega `news2Score` de entradas MPAC/demo | Consumidor indirecto; no puntúa, sin cambios |
| `src/lib/ai-suggestions.ts:27`, `src/screens/HandoverForm.tsx:1887` | Envía score derivado en contexto IA, sin recalcularlo | Consumidor indirecto; sin cambios |
| `src/features/news2/alerts.ts:8,14`, `src/lib/notifications.ts:39` | Clasificación/aviso local de score suministrado | Regla derivada distinta de la banda; sin llamador runtime hallado, no fórmula y sin cambios |
| `src/lib/fhir-map.ts:2006`, `src/lib/fhir-map/*` | Observations, tratamientos y Bundle; no puntúa NEWS2 | Transporte FHIR, sin cambios en esta fase |
| `backend/api/*`, `backend/*` | API, persistencia/bridge; búsqueda sin cálculo NEWS2 | Sin consumidor calculador encontrado; sin cambios |
| `src/config/profiles/overlays/*`, `src/lib/codes.ts:422` | Etiquetas/configuración y código de alerta | Referencias, no fórmula; sin cambios |
| `src/lib/__tests__/news2*`, `tests/screens/news2-input-contract.spec.tsx`, fixtures | RCP, límites, paridad y recorrido QR/formulario | Pruebas/fixtures; no fuente productiva |

Flujos: Observation FHIR → `prefillFromFHIR` → gate FR → canónico Scale 1 →
prioridad prefill → QRScan → HandoverForm. Formulario → gate FR → canónico →
VitalsSection, alertas, riesgo y resúmenes → revisión/envío → mapper FHIR.
API de pacientes → normalizador → gate FR → MPAC/canónico → prioridad y alertas
independientes; el ordenador legacy mantiene los scores precomputados separados.
La fórmula privada de prefill se caracterizó con límites, datos parciales,
ACVPU, oxígeno, prioridades y recorrido QR antes de reemplazarla; ahora delega
en `computeNEWS2` sin sustituir la regla de prioridad de prefill por la banda.
La clasificación de notificaciones no cableadas y los scores legacy no
acreditan procedencia ni paridad con las constantes actuales. El inventario
estático no equivale a validación clínica, institucional o regulatoria.

C17 sigue siendo una dependencia externa no definida. CLINICAL: NOT_VALIDATED.
`test:unit` conserva tres fallos baseline autorizados y no se declara verde.
