# Contrato base de perfiles clinicos

Estado revisado el 2026-03-12.

Este documento describe el contrato minimo ya cableado en el repo para representar:

- HANDOVER Core
- Unit Profile Packs (UPP)
- Specialty Overlay Packs (SOP)
- señales de prioridad contextual tipo MPAC
- placeholders tipados de contexto ICEA+

## 1. Objetivo de esta capa

El objetivo es introducir un lenguaje comun de perfiles sin abrir formularios paralelos ni tocar todavia el payload clinico runtime, el contrato FHIR contextual o la emision runtime de ICEA+.

En esta fase:

- el Core sigue siendo el fallback universal;
- los perfiles y overlays viven en un registry tipado y centralizado;
- la activacion productiva se separa del catalogo maestro;
- la resolucion contextual cae al Core si el pack no existe o no esta activado.

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
- `ProfileRegistry`

Notas importantes:

- `ProfileContext` es un contrato de configuracion y resolucion, no un campo serializado del handover clinico en esta fase.
- `IceaContextVector` queda como placeholder tipado para futuras etapas; no emite datos nuevos en runtime ICEA+ todavia.
- `ContextualPrioritySignal` modela razones explicables de prioridad, pero no introduce aun logica clinica avanzada en produccion.

## 3. Registry maestro

El registry vive en `src/config/profiles/index.ts` y contiene tres capas:

1. `core`
2. `unitProfiles`
3. `specialtyOverlays`

Cada entrada define solo metadatos minimos:

- `id`
- `label`
- `description`
- `activation`
- `enabledSections` o `allowedUnitProfiles` cuando aplica
- `prioritySignals` minimas y explicables
- `iceaContextDefaults` solo como placeholder tipado

## 4. Catalogo maestro vs activacion productiva

El catalogo maestro queda separado de la activacion operativa.

- Catalogo: siempre disponible en el registry.
- Activacion: solo via `EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON` o `HANDOVER_PROFILE_ACTIVATION_JSON`.

Shape soportado:

```json
{
  "unitProfiles": ["critical-care", "general-inpatient"],
  "specialtyOverlays": ["neuroicu"]
}
```

Tambien se acepta un mapa booleano por id:

```json
{
  "unitProfiles": {
    "critical-care": true
  },
  "specialtyOverlays": {
    "onc": true
  }
}
```

Compatibilidad legacy relevante en PRE-02:

- `oncology` ya no significa `ambulatory` de forma fija;
- en activacion, `oncology` se expande a los UPP base compatibles con el SOP `onc`: `general-inpatient`, `ambulatory`, `emergency` y `home-care`;
- en configuracion unitaria, `profileId: 'oncology'` se resuelve segun el metadato de la unidad cuando hay pistas suficientes y, si no las hay, cae prudentemente a `general-inpatient`;
- la resolucion contextual oncológica sigue siendo una compatibilidad de catalogo/configuracion, no una implementacion completa de EOPROP-IA.

Comportamiento por defecto si la variable no existe o es invalida:

- no se activa ningun UPP ni SOP;
- el sistema resuelve `ProfileContext` con fallback al Core;
- un SOP no puede activarse por si solo en PRE-02: requiere un UPP activo y compatible segun `allowedUnitProfiles`;
- los catalogos siguen presentes para futuras activaciones y configuracion.

## 5. Relacion con los catalogos reales del repo

La resolucion contextual se apoya en los catalogos reales ya existentes:

- `src/config/profile-catalog.ts`
- `src/config/units.ts`
- `src/config/specialties.ts`
- `src/config/unitsConfig.ts`

Se anadieron campos aditivos de metadatos para enlazar esos catalogos con el contrato de perfiles:

- `Unit.profileId?`
- `Specialty.defaultUnitProfileId?`
- `Specialty.overlayId?`
- `HandoverUnitConfig.profileId?`
- `HandoverUnitConfig.specialtyOverlayIds?`

Estos campos no rompen los consumidores actuales y permiten que futuros cambios se hagan en configuracion, no con `if/else` clinicos dispersos.

El inventario canonico UPP/SOP y las traducciones legacy explicitas viven en `src/config/profile-catalog.ts` y `src/types/profile.ts`.

Regla de activacion segura en PRE-02:

- un overlay solo puede activarse si el overlay esta habilitado;
- existe un unit profile activo;
- `allowedUnitProfiles` incluye ese unit profile activo;
- si no se cumple alguna de esas condiciones, el overlay se ignora y la resolucion mantiene el fallback compatible al Core.

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
- no se implementa todavia la logica EOPROP-IA ni una estratificacion oncológica avanzada por hospital de dia, urgencias oncológicas, planta o paliativos.


## 7. Runtime UPP PRE-03

La PRE-03 agrega una capa runtime aditiva para el formulario unico:

- `resolveHandoverProfileRuntime` resuelve la unidad activa y mantiene fallback seguro al Core.
- `src/config/profiles/units/core.ts` y `src/config/profiles/units/index.ts` declaran secciones visibles, campos legacy, escalas sugeridas, eventos centinela, quick-picks y salidas visibles por UPP.
- En PRE-08 la Wave 1 operativa queda afinada in place para `critical-care`, `general-inpatient` y `emergency` con foco clinico, explicaciones visibles, quick-picks, checklist de cabecera contextual y eventos a anticipar, sin abrir formularios paralelos.
- `src/lib/profile-runtime.ts` entrega un mapa puro de visibilidad y ayudas contextuales para `HandoverForm`, sin abrir pantallas paralelas ni cambiar el payload clinico runtime.

## 8. Runtime SOP PRE-04

La PRE-04 extiende el runtime del formulario unico con Specialty Overlay Packs sin multiplicar pantallas:

- `src/config/profiles/overlays/index.ts` declara el runtime de cada SOP como capa separada del catalogo maestro y de la activacion productiva.
- `src/types/profile.ts` hace explicitos los puntos de extension permitidos del runtime (`PROFILE_RUNTIME_EXTENSION_POINTS`) para distinguir claves aditivas, ocultacion monotona y visibilidad protegida.
- `src/lib/profile-runtime.ts` aplica merge determinista `Core < UPP < SOP...` en el orden resuelto por contexto y expone una traza auditable por capa real aplicada.
- Partes solo aditivas: `enabledSections`, `requiredExtraFields`, `optionalExtraFields`, `focusAreas`, `explanations`, `scales`, `sentinelEvents`, `quickPicks`, `visibleOutputs` y `notes`.
- En PRE-08 los UPP base tambien pueden proyectar `focusAreas` y `explanations` propias para que la UI y MPAC expliquen el contexto operativo sin depender solo de overlays.
- `hiddenSections` queda monotono: cualquier layer puede ocultar mas secciones, pero un SOP posterior no las reabre por omision. Esto evita reactivaciones accidentales de ruido clinico.
- `visibility` se resuelve con guardrail conservador: un UPP puede afinar campos frente al Core, pero un SOP no puede reactivar campos ya cerrados por capas anteriores. Si lo intenta, la traza marca la clave ignorada y deja nota explicita.
- La trazabilidad visible incluye UPP base, SOP activos, origen del specialty (`explicit`, `unit`, `unit-config`, `none`), si hubo override humano y cualquier guardrail aplicado durante el merge.
- El payload FHIR no cambia en esta fase; la traza se adjunta solo como metadata interna backward compatible para consumidores futuros de FHIR/ICEA/outbox.


