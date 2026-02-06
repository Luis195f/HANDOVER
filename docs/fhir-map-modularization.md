# Modularización de fhir-map

## Objetivo
El módulo `src/lib/fhir-map.ts` se ha organizado en un árbol de módulos en `src/lib/fhir-map/` para separar responsabilidades y facilitar la extensión del mapeo FHIR R4. Esta estructura permite importar por dominio (vitales, medicación, bundle) sin conocer detalles internos.

## Arquitectura

```
Formulario (zod) --> Módulos de mapeo --> Recursos FHIR --> Bundle transaction

                  +-----------------+
                  | vitals.ts       |-----> Observation (vitales)
                  +-----------------+
                  | medication.ts   |-----> MedicationStatement/Administration
                  +-----------------+
                  | nutrition.ts    |-----> Observation (nutrición)
                  +-----------------+
                  | elimination.ts  |-----> Observation (eliminación)
                  +-----------------+
                  | mobility.ts     |-----> Observation (movilidad/piel)
                  +-----------------+
                  | procedures.ts   |-----> Procedure
                  +-----------------+
                  | exams.ts        |-----> Observation (exámenes)
                  +-----------------+
                  | risk.ts         |-----> Condition/DetectedIssue
                  +-----------------+
                               |
                               v
                        bundle.ts (buildHandoverBundle)
```

## Módulos principales

- `index.ts`: punto de entrada, re-exporta las APIs principales.
- `types.ts`: tipos FHIR y modelos compartidos.
- `constants.ts`: constantes y ayudas de test (por ejemplo `__test__`).
- `vitals.ts`: mapeo de signos vitales (`mapObservationVitals`, `mapVitalsToObservations`).
- `medication.ts`: mapeo de medicación (`mapMedicationStatements`).
- `nutrition.ts`, `elimination.ts`, `mobility.ts`: cuidados de enfermería.
- `procedures.ts`, `exams.ts`: procedimientos y exámenes.
- `risk.ts`: riesgos y condiciones detectadas.
- `bundle.ts`: composición y construcción del `Bundle` final.

> Nota: la modularización mantiene compatibilidad con `src/lib/fhir-map.ts` (API legacy) mientras se migra el resto del código a importaciones por dominio.

## Convenciones de mapeo

- Las funciones de mapeo reciben datos validados con Zod (ver `src/validation/schemas.ts`).
- Cada función devuelve recursos FHIR puros (sin efectos secundarios).
- Se reutilizan helpers para referencias, codificaciones y normalización de fechas.
- Las rutas de codificación usan sistemas oficiales (por ejemplo:
  `http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration`).

## Tests

Los tests viven en `src/lib/__tests__` y validan:

- Observaciones de vitales (códigos, categorías y paneles).
- Medicación estructurada (MedicationStatement/MedicationAdministration).
- Construcción del bundle con referencias coherentes.

Para ejecutar:

```
pnpm vitest run --reporter=verbose
```

## Extender el mapeo

1. Crear un nuevo módulo en `src/lib/fhir-map/` para la sección (por ejemplo `rehab.ts`).
2. Añadir funciones puras que devuelvan recursos FHIR.
3. Exportar desde `index.ts` y (si aplica) añadir al `Bundle` en `bundle.ts`.
4. Añadir tests unitarios con fixtures representativos.
