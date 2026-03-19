# Catalogo maestro de perfiles clinicos

Estado revisado el 2026-03-19.

Este archivo separa dos capas que en el repo cumplen funciones distintas:

- `src/config/profile-catalog.ts`: inventario maestro de Unit Profile Packs (UPP) y Specialty Overlay Packs (SOP), con ids canonicos, aliases legacy y readiness conservadora.
- `src/config/specialties.ts` + `src/config/units.ts`: subset operativo visible hoy en UI, mantenido prudente para no abrir activaciones masivas por defecto.

Principio aplicado en PRE-10:

- el repo conoce mas overlays clinicos de los que hoy expone en la UX operativa;
- ningun pack nuevo queda activado por defecto;
- la activacion productiva sigue pasando por `HANDOVER_PROFILE_ACTIVATION_JSON`;
- los ids operativos legacy (`cvicu`, `neuroicu`, `neph`, `infect`, `ped`, `ob`, `critical-emergency`, etc.) se normalizan hacia ids canonicos Wave 1 del framework maestro.

## UPP maestro exacto

| ID canonico | Label | Readiness | Cobertura documental |
| --- | --- | --- | --- |
| `emergency` | Urgencias y emergencias | Wave 1 | Urgencias/Emergencias |
| `general-inpatient` | Hospitalizacion general | Wave 1 | Hospitalizacion general |
| `critical-care` | UCI adulto | Wave 1 | UCI adulto |
| `pediatric-critical-care` | UCI neonatal y pediatrica | Scaffold | UCI neonatal/pediatrica |
| `specialized-critical-care` | UCI especializada | Wave 1 | UCI especializada |
| `maternal-perinatal` | Materno-perinatal | Wave 1 | Materno-perinatal |
| `perioperative` | Quirofano y recuperacion | Wave 1 | Quirofano/Recuperacion |
| `ambulatory` | Consulta externa y ambulatoria | Wave 1 | Consulta externa/ambulatoria |
| `rehabilitation` | Rehabilitacion y terapias | Scaffold | Rehabilitacion/Terapias |
| `long-term-care` | Residencias y larga estadia | Scaffold | Residencias/larga estadia |
| `behavioral-health` | Salud mental | Scaffold | Salud mental |
| `home-care` | Atencion domiciliaria | Scaffold | Atencion domiciliaria |

## SOP maestro exacto

`onc` se preserva como overlay Wave 1 de PRE-09 y no se reabre clinicamente en PRE-10 salvo compatibilidad minima. PRE-10 completa la primera oleada del framework maestro con ids canonicos explicitos.

| ID canonico | Label | Estado PRE-10 | Cobertura documental |
| --- | --- | --- | --- |
| `cardio` | Cardiologia y cirugia cardiovascular | Wave 1 / pilot-ready | Cardiologia/Cirugia cardiovascular |
| `neuro` | Neurologia y neurocirugia | Wave 1 / pilot-ready | Neurologia/Neurocirugia |
| `onc` | Oncologia y hematologia | Wave 1 heredado de PRE-09 | Oncologia/Hematologia (EOPROP-IA) |
| `trauma` | Traumatologia y ortopedia | Wave 1 / pilot-ready | Traumatologia/Ortopedia |
| `infecto` | Infectologia | Wave 1 / pilot-ready | Infectologia |
| `neumo` | Neumologia | Wave 1 / pilot-ready | Neumologia |
| `nefroUro` | Nefrologia y urologia | Wave 1 / pilot-ready | Nefrologia/Urologia |
| `gastroHepato` | Gastroenterologia y hepatologia | Wave 1 / pilot-ready | Gastroenterologia/Hepatologia |
| `endo` | Endocrinologia | Wave 1 / pilot-ready | Endocrinologia |
| `gynObs` | Ginecologia y obstetricia | Wave 1 / pilot-ready | Ginecologia/Obstetricia |
| `pedsSubspecialties` | Pediatria y subespecialidades | Registry-only / pilot-off | Pediatria y subespecialidades |
| `ophthalEnt` | Oftalmologia y otorrinolaringologia | Registry-only / pilot-off | Oftalmologia/ORL |
| `plasticsBurns` | Cirugia plastica y quemados | Registry-only / pilot-off | Cirugia plastica/Quemados |
| `criticalEmergency` | Medicina critica y emergencias | Registry-only / pilot-off | Medicina critica/Emergencias |
| `transplant` | Trasplante de organos solidos | Registry-only / pilot-off | Trasplante de organos solidos |

Nota PRE-10:

- `criticalEmergency` queda registrado pero no se promueve a pilot-ready en esta PRE para evitar solapamiento prematuro con los UPP `emergency` y `critical-care`.
- `pedsSubspecialties` queda catalogado y testeado, pero solo compatible por ahora con base pediatrica explicita (`pediatric-critical-care`).

## Traducciones legacy intencionales

Estas traducciones se mantienen por compatibilidad con ids ya usados en configuracion previa, pero ya no forman parte del inventario canonico UPP/SOP.

| ID legacy | Resolucion PRE-10 | Motivo |
| --- | --- | --- |
| `oncology` | Alias legacy contextual para el overlay `onc` sobre `general-inpatient`, `ambulatory`, `emergency` o `home-care` | PRE-09 mantiene EOPROP-IA como overlay transversal sin colapsarlo a una sola base. |
| `pediatrics` | `general-inpatient` | El source of truth sigue ubicando pediatria general sobre base compartida; el overlay canonico queda en `pedsSubspecialties`. |
| `cvicu` | `cardio` | El id visible historicamente en UI se conserva como alias operacional hacia el catalogo maestro. |
| `neuroicu` | `neuro` | El specialty operativo sigue visible, pero el repo resuelve el overlay canonico `neuro`. |
| `neph` | `nefroUro` | Canonizacion Wave 1 del overlay renal/urologico. |
| `gastro` | `gastroHepato` | Canonizacion Wave 1 del overlay digestivo/hepatico. |
| `pulm` | `neumo` | Canonizacion Wave 1 del overlay respiratorio. |
| `infect` | `infecto` | Canonizacion Wave 1 del overlay infectologico. |
| `ped` | `pedsSubspecialties` | Overlay pediatrico registry-only con activacion prudente. |
| `ob` / `gyn` | `gynObs` | El source of truth define una sola entidad combinada Ginecologia/Obstetricia. |
| `ent` | `ophthalEnt` | Canonizacion del overlay oftalmo-ORL. |
| `burns` | `plasticsBurns` | Canonizacion del overlay plastica/quemados. |
| `critical-emergency` | `criticalEmergency` | Canonizacion del overlay transversal critico de urgencias. |

Estas traducciones se aplican en:

- `src/types/profile.ts`
- `src/config/unitsConfig.ts`
- `src/config/profiles/index.ts`
- `src/config/profiles/__tests__/index.spec.ts`
- `src/config/profiles/__tests__/catalog.spec.ts`

## Subset operativo visible hoy

La UI visible hoy sigue limitada a especialidades y unidades ya presentes en el repo para no inflar filtros ni UX de forma artificial.

Especialidades operativas visibles hoy:

- `icu` -> sin overlay explicito por defecto
- `ed` -> overlay canonico `criticalEmergency` (catalogado, no activado por defecto)
- `onc` -> overlay canonico `onc`
- `neph` -> overlay canonico `nefroUro`
- `ped` -> overlay canonico `pedsSubspecialties`
- `ob` -> overlay canonico `gynObs`
- `neuroicu` -> overlay canonico `neuro`
- `cvicu` -> overlay canonico `cardio`

Unidades demo/operativas existentes:

- `icu-a`, `icu-b`, `ed-main`, `ed-obs`, `onc-ward`, `neph-hd`, `ped-ward`, `ob-labor`, `neuroicu-1`, `cvicu-1`

Eso no reduce el catalogo maestro: solo preserva la activacion prudente del PRE-10.
