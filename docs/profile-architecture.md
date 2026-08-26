# Contrato base de perfiles clinicos

Estado revisado el 2026-03-19.

Este documento describe el contrato minimo ya cableado en el repo para representar:

- HANDOVER Core
- Unit Profile Packs (UPP)
- Specialty Overlay Packs (SOP)
- senales de prioridad contextual tipo MPAC
- placeholders tipados de contexto ICEA+

## 1. Objetivo de esta capa

El objetivo es introducir un lenguaje comun de perfiles sin abrir formularios paralelos ni tocar todavia el payload clinico runtime, el contrato FHIR contextual o la emision runtime de ICEA+.

En esta fase:

- el Core sigue siendo el fallback universal;
- los perfiles y overlays viven en un registry tipado y centralizado;
- la activacion productiva se separa del catalogo maestro;
- la resolucion contextual cae al Core si el pack no existe o no esta activado;
- los SOP Wave 1 quedan canonizados con ids maestros (`cardio`, `neuro`, `infecto`, `neumo`, `nefroUro`, `gastroHepato`, `gynObs`, etc.) sin romper compatibilidad con ids operativos legacy del repo.

## 2. Tipos principales

Implementacion principal:

- `src/types/profile.ts`
- `src/config/profiles/index.ts`

Tipos base introducidos:

- `UnitProfileId`
- `SpecialtyOverlayId`
- `ProfileContext`
- `ContextualPrioritySignal`
- `IceaContextVector`
- `IceaContextPlaceholderKey`
- `ProfileRegistry`

Notas importantes:

- `ProfileContext` es un contrato de configuracion y resolucion, no un campo serializado del handover clinico en esta fase.
- `IceaContextVector` queda como placeholder tipado para futuras etapas; no emite datos nuevos en runtime ICEA+ todavia.
- `IceaContextPlaceholderKey` explicita que dimensiones ICEA+ espera cada overlay sin activar aun un runtime nuevo.
- `ContextualPrioritySignal` modela razones explicables de prioridad; PRE-10 amplia estas senales por overlay sin cambiar transporte clinico ni FHIR.

## 3. Registry maestro

El registry vive en `src/config/profiles/index.ts` y contiene tres capas:

1. `core`
2. `unitProfiles`
3. `specialtyOverlays`

Cada entrada define metadatos minimos y trazables:

- `id`
- `label`
- `description`
- `activation`
- `enabledSections` o `allowedUnitProfiles` cuando aplica
- La unidad `udcc-psychogeriatrics` habilita `elimination` mediante `features.enableElimination`; el UPP compartido `behavioral-health` no cambia y las unidades adultas e infanto-adolescentes no heredan esa visibilidad.
- `prioritySignals` explicables
- `iceaContextDefaults` solo como placeholder tipado
- `iceaContextPlaceholders` para declarar el vector ICEA+ esperado por overlay

## 4. Catalogo maestro vs activacion productiva

El catalogo maestro queda separado de la activacion operativa.

- Catalogo: siempre disponible en el registry.
- Activacion: solo via `EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON` o `HANDOVER_PROFILE_ACTIVATION_JSON`.

Shape soportado:

```json
{
  "unitProfiles": ["critical-care", "general-inpatient"],
  "specialtyOverlays": ["neuro"]
}
```

Tambien se acepta un mapa booleano por id:

```json
{
  "unitProfiles": {
    "critical-care": true
  },
  "specialtyOverlays": {
    "cardio": true
  }
}
```

Compatibilidad legacy relevante en PRE-10:

- `cvicu -> cardio`
- `neuroicu -> neuro`
- `neph -> nefroUro`
- `gastro -> gastroHepato`
- `pulm -> neumo`
- `infect -> infecto`
- `ped -> pedsSubspecialties`
- `ob` y `gyn -> gynObs`
- `ent -> ophthalEnt`
- `burns -> plasticsBurns`
- `critical-emergency -> criticalEmergency`
- `oncology` sigue expandiendo los UPP base compatibles con `onc`: `general-inpatient`, `ambulatory`, `emergency` y `home-care`

Comportamiento por defecto si la variable no existe o es invalida:

- no se activa ningun UPP ni SOP;
- el sistema resuelve `ProfileContext` con fallback al Core;
- un SOP no puede activarse por si solo: requiere un UPP activo y compatible segun `allowedUnitProfiles`;
- los catalogos siguen presentes para futuras activaciones y configuracion.

## 5. Relacion con los catalogos reales del repo

La resolucion contextual se apoya en los catalogos reales ya existentes:

- `src/config/profile-catalog.ts`
- `src/config/units.ts`
- `src/config/specialties.ts`
- `src/config/unitsConfig.ts`

Se mantienen campos aditivos de metadatos para enlazar esos catalogos con el contrato de perfiles:

- `Unit.profileId?`
- `Specialty.defaultUnitProfileId?`
- `Specialty.overlayId?`
- `HandoverUnitConfig.profileId?`
- `HandoverUnitConfig.specialtyOverlayIds?`

PRE-10 anade una regla util de compatibilidad: si el `specialtyId` recibido ya coincide con un `SpecialtyOverlayId` canonico, el resolver puede usarlo como overlay explicito aunque no exista una entrada visible en `src/config/specialties.ts`.

## 6. Compatibilidad y limites explicitamente preservados

Se preserva en esta fase:

- captura actual del formulario
- validacion Zod actual del handover
- mapping FHIR existente
- sync/offline actual
- runtime ICEA+ actual

No se hace en esta fase:

- no se serializa `ProfileContext` dentro del handover clinico;
- no se cambia el contrato contextual FHIR;
- no se emiten nuevos vectores ICEA+ en runtime;
- no se activan todos los perfiles por defecto;
- `criticalEmergency`, `pedsSubspecialties`, `ophthalEnt`, `plasticsBurns` y `transplant` quedan completos en catalogo/runtime pero en estado `registry-only` / `catalog`.

## 7. Runtime UPP PRE-03

La PRE-03 agrega una capa runtime aditiva para el formulario unico:

- `resolveHandoverProfileRuntime` resuelve la unidad activa y mantiene fallback seguro al Core.
- `src/config/profiles/units/core.ts` y `src/config/profiles/units/index.ts` declaran secciones visibles, campos legacy, escalas sugeridas, eventos centinela, quick-picks y salidas visibles por UPP.
- En PRE-08 la Wave 1 operativa queda afinada in place para `critical-care`, `general-inpatient` y `emergency` con foco clinico, explicaciones visibles, quick-picks, checklist de cabecera contextual y eventos a anticipar, sin abrir formularios paralelos.
- `src/lib/profile-runtime.ts` entrega un mapa puro de visibilidad y ayudas contextuales para `HandoverForm`, sin abrir pantallas paralelas ni cambiar el payload clinico runtime.
- Para piloto, el fallback Core mantiene visible el bloque comun de oxigenoterapia, escalas y pendientes/examenes; el plan inmediato y las contingencias siguen en el formulario unico pero fuera del checklist de cierre para reducir omisiones operativas.

## 8. Runtime SOP PRE-04 a PRE-10

La PRE-04 extiende el runtime del formulario unico con Specialty Overlay Packs sin multiplicar pantallas.

- `src/config/profiles/overlays/*.ts` declara un archivo por overlay runtime para mantener merge determinista y trazabilidad por pack.
- `src/config/profiles/overlays/index.ts` agrega el inventario completo de SOP canonicos del framework maestro.
- `src/types/profile.ts` hace explicitos los puntos de extension permitidos del runtime (`PROFILE_RUNTIME_EXTENSION_POINTS`) para distinguir claves aditivas, ocultacion monotona y visibilidad protegida.
- `src/lib/profile-runtime.ts` aplica merge determinista `Core < UPP < SOP...` en el orden resuelto por contexto y expone una traza auditable por capa real aplicada.
- PRE-10 completa Wave 1 con contenido minimo exacto por overlay: `enabledSections`, variables minimas expuestas en `requiredExtraFields`, `focusAreas`, `explanations`, `sentinelEvents`, `visibleOutputs`, `quickPicks`, `prioritySignals`, `iceaContextDefaults` y `iceaContextPlaceholders`.
- `onc` se preserva desde PRE-09 como overlay operacional; PRE-10 no reabre su contrato clinico salvo compatibilidad con ids canonicos y tests.

Guardrails runtime que se preservan:

- `hiddenSections` queda monotono: una seccion ya ocultada no se reabre por omision.
- `visibility` se resuelve con guardrail conservador: un SOP no puede reactivar campos ya cerrados por capas anteriores.
- la activacion por defecto sigue siendo `false` para todos los overlays, incluso los pilot-ready.

## 9. MPAC y trazabilidad contextual

MPAC sigue consumiendo `ProfileContext` y `prioritySignals` sin cambiar de arquitectura.

PRE-10 amplia:

- senales explicables por overlay canonico;
- labels y `profileId` canonicos en los modificadores contextuales;
- trazabilidad de overlays activos, overlays catalogados pero incompatibles y overrides humanos;
- placeholders ICEA+ por overlay sin emision runtime nueva.

Esto permite que MPAC conserve explicabilidad por overlay sin tocar FHIR, sync, queue ni el runtime ICEA+ previo a PRE-12.
