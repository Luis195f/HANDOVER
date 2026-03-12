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
  "unitProfiles": ["critical-care", "pediatrics"],
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

Comportamiento por defecto si la variable no existe o es invalida:

- no se activa ningun UPP ni SOP;
- el sistema resuelve `ProfileContext` con fallback al Core;
- un SOP no puede activarse por si solo en PRE-01: requiere un UPP activo y compatible segun `allowedUnitProfiles`;
- los catalogos siguen presentes para futuras activaciones y configuracion.

## 5. Relacion con los catalogos reales del repo

La resolucion contextual se apoya en los catalogos reales ya existentes:

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

Regla de activacion segura en PRE-01:

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
- no se activan todos los perfiles por defecto.

