# EOPROP-IA en HANDOVER

Estado revisado el 2026-03-19.

## Objetivo

EOPROP-IA opera en HANDOVER como un Specialty Overlay Pack onco-hematologico sobre el stack existente `Core < UPP < SOP`.

No crea:

- formulario paralelo
- pantalla obligatoria nueva
- payload FHIR alternativo
- flujo de escritura duplicado

## Donde vive

- Registry y activacion: `src/config/profiles/index.ts`
- Runtime del overlay: `src/config/profiles/overlays/oncologyHematology.ts`
- Merge determinista y trazabilidad: `src/lib/profile-runtime.ts`
- Priorizacion explicable MPAC: `src/lib/mpac.ts`

## Variables minimas modeladas sin duplicar escritura

El overlay proyecta en la UI existente y en la salida breve:

- fase terapeutica
- inmunosupresion
- CVC
- sintoma toxico dominante
- transfusion cuando aplique
- paliacion / objetivos de cuidado cuando aplique

Estas variables se modelan como `requiredExtraFields`, `optionalExtraFields`, `focusAreas`, `sentinelEvents`, `quickPicks` y `visibleOutputs`.

## Riesgos y eventos que prioriza

- neutropenia febril
- sepsis
- extravasacion
- dolor no controlado
- deshidratacion
- complicaciones de tratamiento sistemico

## Salida breve reutilizable

Sin cambiar la arquitectura, el overlay deja salida corta y explicable en los canales ya existentes:

- formulario: foco clinico, campos extra minimos, eventos criticos y salidas visibles
- lista y dashboard: por que ahora, que no omitir y ventana de reevaluacion a partir de MPAC + priority UI
- checklist/quick-picks: recordatorios operativos sin escribir dos veces lo mismo

## Compatibilidad preservada

- `oncology` sigue siendo alias legacy contextual del overlay `onc`
- no se activan perfiles por defecto fuera de la activacion ya existente
- no cambia el contrato FHIR
- no cambia el contrato runtime de ICEA+
- `iceaContextDefaults` sigue siendo placeholder tipado y backward compatible
