# Catalogo maestro de perfiles clinicos

Estado revisado el 2026-03-12.

Este archivo separa dos capas que en el repo cumplen funciones distintas:

- `src/config/profile-catalog.ts`: inventario maestro de Unit Profile Packs (UPP) y Specialty Overlay Packs (SOP), con ids canonicos, aliases clinicos y readiness.
- `src/config/units.ts` + `src/config/specialties.ts`: subset operativo visible hoy en UI, mantenido prudente para no abrir activaciones masivas por defecto.

Principio aplicado en PRE-02:

- el repo conoce mas packs clinicos de los que hoy expone en la UX operativa;
- ningun pack nuevo queda activado por defecto;
- la activacion productiva sigue pasando por `HANDOVER_PROFILE_ACTIVATION_JSON`;
- cualquier traduccion legacy entre ids historicos y catalogo canonico queda explicita, documentada y testeada.

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

| ID canonico | Label | Readiness | Cobertura documental |
| --- | --- | --- | --- |
| `cvicu` | Cardiologia y cirugia cardiovascular | Wave 1 | Cardiologia/Cirugia cardiovascular |
| `neuroicu` | Neurologia y neurocirugia | Wave 1 | Neurologia/Neurocirugia |
| `onc` | Oncologia y hematologia | Wave 1 | Oncologia/Hematologia (EOPROP-IA) |
| `trauma` | Traumatologia y ortopedia | Scaffold | Traumatologia/Ortopedia |
| `neph` | Nefrologia y urologia | Wave 1 | Nefrologia/Urologia |
| `gastro` | Gastroenterologia y hepatologia | Scaffold | Gastroenterologia/Hepatologia |
| `endo` | Endocrinologia | Scaffold | Endocrinologia |
| `pulm` | Neumologia | Scaffold | Neumologia |
| `infect` | Infectologia | Scaffold | Infectologia |
| `ped` | Pediatria y subespecialidades | Wave 1 | Pediatria y subespecialidades |
| `ob` | Ginecologia y obstetricia | Wave 1 | Ginecologia/Obstetricia |
| `ent` | Oftalmologia y otorrinolaringologia | Scaffold | Oftalmologia/ORL |
| `burns` | Cirugia plastica y quemados | Scaffold | Cirugia plastica/Quemados |
| `critical-emergency` | Medicina critica y emergencias | Wave 1 | Medicina critica/Emergencias |
| `transplant` | Trasplante de organos solidos | Scaffold | Trasplante de organos solidos |

## Traducciones legacy intencionales

Estas traducciones se mantienen por compatibilidad con ids ya usados en configuracion previa, pero ya no forman parte del inventario canonico UPP/SOP.

| ID legacy | Resolucion PRE-09 | Motivo |
| --- | --- | --- |
| `oncology` | Alias legacy contextual para el overlay `onc` sobre `general-inpatient`, `ambulatory`, `emergency` o `home-care` | El source of truth multiunidad ubica oncologia/hematologia como SOP transversal. PRE-09 implementa EOPROP-IA como overlay contextual real sin afirmar la equivalencia falsa `oncology == ambulatory`. Cuando hay contexto de unidad se resuelve al UPP base compatible; sin contexto suficiente cae prudentemente a `general-inpatient`. En activacion JSON el alias se expande al set completo compatible. |
| `pediatrics` | `general-inpatient` | El source of truth ubica pediatria general como overlay/subespecialidad sobre base de hospitalizacion, no como UPP independiente. |
| `gyn` | `ob` | El source of truth define una sola entidad combinada Ginecologia/Obstetricia; el id operativo `ob` se conserva por compatibilidad. |

La compatibilidad legacy oncológica queda asi delimitada en PRE-09:

- resuelto ahora: catalogo maestro correcto, alias legacy explicito, expansion segura en activacion, resolucion contextual basica por metadatos de unidad y overlay operativo EOPROP-IA sobre `general-inpatient`, `ambulatory`, `emergency` y `home-care`;
- preservado: no hay activaciones nuevas por defecto, no cambia FHIR y no cambia el runtime ICEA+;
- no resuelto aun: vectores ICEA+ emitidos en runtime o un contrato FHIR contextual nuevo para oncologia/hematologia.

Estas traducciones se aplican en:

- `src/types/profile.ts`
- `src/config/unitsConfig.ts`
- `src/config/profiles/index.ts`
- `src/config/profiles/__tests__/index.spec.ts`
- `src/config/profiles/__tests__/catalog.spec.ts`

## Subset operativo visible hoy

La UI visible hoy sigue limitada a especialidades y unidades ya presentes en el repo para no inflar filtros ni UX de forma artificial:

- especialidades operativas: `icu`, `ed`, `onc`, `neph`, `ped`, `ob`, `neuroicu`, `cvicu`
- unidades demo/operativas existentes: `icu-a`, `icu-b`, `ed-main`, `ed-obs`, `onc-ward`, `neph-hd`, `ped-ward`, `ob-labor`, `neuroicu-1`, `cvicu-1`

Eso no reduce el catalogo maestro: solo preserva la activacion prudente del PRE-02.
