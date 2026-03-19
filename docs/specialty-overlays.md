# Specialty Overlays

Estado revisado el 2026-03-19.

Este documento resume el estado real de los Specialty Overlay Packs (SOP) en PRE-10 dentro del stack actual HANDOVER Core -> UPP -> SOP -> MPAC, sin crear pantallas paralelas ni modificar contratos FHIR/ICEA runtime.

## Reglas operativas de PRE-10

- Todos los SOP quedan registrados en configuracion versionable.
- Ningun SOP queda `enabledByDefault`.
- `wave-1` significa `activation.stage = pilot`.
- `registry-only` significa `activation.stage = catalog` y `pilot-off`.
- Los ids canonicos del repo son los del framework maestro (`cardio`, `neuro`, `infecto`, `neumo`, `nefroUro`, `gastroHepato`, `gynObs`, etc.).
- Los ids legacy siguen aceptandose por compatibilidad (`cvicu`, `neuroicu`, `neph`, `infect`, `ped`, `ob`, `critical-emergency`, etc.).

## Pilot-ready

| SOP | Compatibilidad UPP | Foco resumido | ICEA+ esperado |
| --- | --- | --- | --- |
| `cardio` | `specialized-critical-care`, `critical-care`, `emergency`, `general-inpatient`, `home-care` | dolor toracico, perfusion, insuficiencia cardiaca, arritmia, anticoagulacion, congestion | `temporalCriticality`, `therapeuticLoad`, `coordinationComplexity` |
| `neuro` | `specialized-critical-care`, `critical-care`, `emergency`, `general-inpatient`, `rehabilitation` | conciencia, deficit focal, convulsion, pupilas, deglucion | `surveillanceIntensity`, `dependencyLoad`, `temporalCriticality` |
| `trauma` | `emergency`, `critical-care`, `general-inpatient`, `rehabilitation` | mecanismo, sangrado, dolor, inmovilizacion, control neurovascular distal | `temporalCriticality`, `therapeuticLoad`, `coordinationComplexity` |
| `infecto` | `critical-care`, `general-inpatient`, `ambulatory`, `home-care`, `emergency` | foco infeccioso, sepsis, aislamiento, antimicrobianos, control de foco | `surveillanceIntensity`, `temporalCriticality`, `continuityRisk` |
| `neumo` | `critical-care`, `emergency`, `general-inpatient`, `home-care` | oxigenacion, ventilacion, secreciones, NIV, fatiga respiratoria | `surveillanceIntensity`, `therapeuticLoad`, `dependencyLoad` |
| `nefroUro` | `general-inpatient`, `emergency`, `ambulatory`, `home-care` | diuresis, balance, AKI, electrolitos, obstruccion, accesos | `therapeuticLoad`, `continuityRisk`, `coordinationComplexity` |
| `gastroHepato` | `general-inpatient`, `emergency`, `ambulatory`, `home-care` | sangrado digestivo, encefalopatia, dolor abdominal, drenajes, ostomias | `therapeuticLoad`, `continuityRisk`, `dependencyLoad` |
| `endo` | `general-inpatient`, `emergency`, `ambulatory`, `home-care` | glucemia, insulina, cetosis, esteroides, crisis metabolicas | `therapeuticLoad`, `temporalCriticality`, `continuityRisk` |
| `gynObs` | `maternal-perinatal`, `general-inpatient`, `emergency`, `ambulatory`, `home-care` | sangrado, dolor, HTA, puerperio/embarazo, perdidas, vigilancia materna | `temporalCriticality`, `coordinationComplexity`, `continuityRisk` |

Nota PRE-09: `onc` sigue operativo como overlay Wave 1 heredado de EOPROP-IA y se mantiene sin cambios de arquitectura en PRE-10.

## Registry-only / Pilot-off

| SOP | Compatibilidad UPP | Estado prudente | ICEA+ esperado |
| --- | --- | --- | --- |
| `pedsSubspecialties` | `pediatric-critical-care` | Catalogado y testeado; no activar por defecto fuera de base pediatrica explicita | `dependencyLoad`, `surveillanceIntensity`, `coordinationComplexity` |
| `ophthalEnt` | `ambulatory`, `emergency`, `general-inpatient` | Catalogado completo; pilot-off | `therapeuticLoad`, `continuityRisk` |
| `plasticsBurns` | `emergency`, `general-inpatient`, `home-care` | Catalogado completo; puede coexistir con `trauma` cuando la base UPP siga siendo compatible | `therapeuticLoad`, `surveillanceIntensity`, `dependencyLoad` |
| `criticalEmergency` | `emergency`, `critical-care` | Catalogado completo; pilot-off para no duplicar logica base de los UPP criticos | `temporalCriticality`, `surveillanceIntensity`, `coordinationComplexity` |
| `transplant` | `general-inpatient`, `ambulatory`, `home-care`, `critical-care` | Catalogado completo; pilot-off | `surveillanceIntensity`, `continuityRisk`, `therapeuticLoad`, `coordinationComplexity` |

## Contenido minimo implementado por SOP

Cada overlay canonico deja implementado como minimo en `src/config/profiles/overlays/*.ts` y `src/config/profiles/index.ts`:

- `label`
- `enabledSections` aditivas
- `requiredExtraFields` / `optionalExtraFields` para variables minimas
- `focusAreas`
- `explanations`
- `sentinelEvents`
- `visibleOutputs`
- `quickPicks`
- `prioritySignals` explicables
- `iceaContextDefaults`
- `iceaContextPlaceholders`
- compatibilidad explicita con UPP base (`allowedUnitProfiles`)
- readiness y `activation.stage` prudente

## Archivos fuente

- `src/config/profile-catalog.ts`
- `src/config/profiles/index.ts`
- `src/config/profiles/overlays/index.ts`
- `src/config/profiles/overlays/*.ts`
- `src/lib/__tests__/profile-runtime.spec.ts`
- `src/config/profiles/__tests__/catalog.spec.ts`
- `tests/lib/mpac.spec.ts`
