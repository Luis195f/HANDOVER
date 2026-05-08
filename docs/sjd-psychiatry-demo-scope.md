# Demo SJD Psiquiatría: contexto, alcance y límites

Estado revisado el 2026-05-08.

## Objetivo

Preparar un demo serio y prudente de HANDOVER + ICEA para el Hospital Psiquiátrico San Juan de Dios sin presentar el estado actual del repo como producto final, validado ni production-ready.

Este documento define el alcance de demo para tres contextos objetivo:

- psiquiatría adulto;
- psiquiatría infanto-adolescente;
- psicogeriatría / UDCC / deterioro cognitivo-conductual.

## Estado real del repo tras este PR

Seams ya existentes y reutilizables:

- frontend React Native / Expo + TypeScript;
- backend Django + DRF;
- formulario único con validación Zod;
- exportación FHIR transaccional;
- cola offline / sync / retry ya cableados;
- control plane prudente por unidad, rol y entorno;
- bridge ICEA desacoplado y documentado en shadow mode;
- catálogo de perfiles con `behavioral-health` ya presente como `scaffold`;
- runtime UPP `behavioral-health` presente en `src/config/profiles/units/index.ts`.

Seams SJD psiquiatría implementados en este PR:

- especialidad visible `psych` en `src/config/specialties.ts`;
- unidades `sjd-a`, `sjd-b`, `sjd-infanto` y `udcc-psychogeriatrics` en `src/config/units.ts`;
- configuración estática de esas unidades en `src/config/unitsConfig.ts`;
- mapeo de esas unidades al perfil común `behavioral-health`;
- checklist y runtime mínimo reforzado para salud mental;
- identificación por QR desactivada por defecto para `behavioral-health`, `psych` y las unidades SJD/UDCC;
- QR reactivable únicamente mediante flag explícito;
- documentación demo enlazada desde `docs/MVP_DEMO.md`.

Límites observados tras este PR:

- no existe todavía un overlay psiquiátrico SJD específico;
- el runtime `behavioral-health` sigue siendo común y prudente, no una modelización clínica completa por subunidad;
- adulto, infanto-adolescente y psicogeriatría/UDCC todavía no tienen campos diferenciales completos;
- la evidencia demo actual aún no incluye fixtures sintéticos SJD trazados de punta a punta;
- no se ha modificado backend, FHIR, ICEA, auth/RBAC ni sync/offline queue;
- los documentos clínicos locales SJD siguen siendo insumos externos de validación, no evidencia incorporada al repo.

## Guardrails de demo que sí quedan autorizados

- Mantener un único formulario y el pipeline actual UI -> Zod -> FHIR -> queue/sync -> fhir-client -> servidor FHIR/HCE.
- Resolver variaciones por perfiles, overlays y composición sobre costuras existentes.
- Mantener ICEA como shadow mode agregado, no nominal ni punitivo.
- Mantener MPAC como prioridad explicable y revisable.
- Mantener la decisión clínica final como juicio humano.
- Usar solo datos sintéticos en fixtures, demo mode y walkthrough.

## Guardrails psiquiátricos específicos para este demo

- QR queda como capacidad opcional o futura, detrás de flag, desactivada por defecto en el recorrido psiquiátrico.
- La identificación principal del demo debe apoyarse en censo/listado de unidad, búsqueda manual, ubicación funcional, cama/planta o identificador institucional.
- La app no debe exponer información a familiares; solo registrar coordinación interna cuando proceda.
- La contención mecánica no debe describirse con instrucciones operativas detalladas; el demo solo puede mostrar estado, autorización, revisiones, trazabilidad y referencia a protocolo local.
- No deben mostrarse rankings de “peligrosidad”.
- Las prioridades visibles deben expresarse como continuidad, observación, riesgo de omisión, cambio respecto a basal o necesidad de coordinación.
- No deben generarse recomendaciones clínicas autónomas; solo checklist, recordatorios, síntesis SBAR y continuidad de turno.

## Fuentes clínicas externas esperadas para el demo

Este repo no contiene con nombres verificables los documentos locales SJD listados en el encargo. Por tanto, deben tratarse como insumos externos de validación clínica/operativa y no como archivos ya incorporados al workspace.

Fuentes a mapear fuera del repo o a incorporar después de saneamiento institucional:

- Actividades mañana SJD A y SJD B.
- Actividades tarde SJD A y SJD B.
- Actividades turno noche.
- CRONO DUE A 2025.
- Procedimiento/protocolo de contención mecánica.
- Protocolo de prevención de caídas.
- Protocolo de fugas.
- UDCC cronograma mañana y tarde.
- Valoración funcional.
- Protocolo de fallecimiento solo como referencia futura, fuera del objetivo inicial de demo.

## Lectura clínica objetivo del demo

El recorrido demo debe demostrar que HANDOVER ayuda a:

- leer parte diario y solape;
- preparar cambio de turno;
- revisar pacientes por unidad/planta;
- registrar observación especial;
- registrar riesgos de caídas, fuga/no retorno, conducta, adherencia, sueño, hidratación, alimentación y deterioro funcional;
- revisar medicación y tratamientos pendientes;
- registrar contención solo como evento trazable y protocolizado;
- generar un SBAR psiquiátrico prudente;
- preparar continuidad para el turno siguiente;
- alimentar ICEA shadow agregado sin score individual visible.

## Mapa de ramas del trabajo

Orden previsto de implementación, manteniendo un objetivo por rama:

1. `docs/sjd-psychiatry-context-and-demo-scope`
2. `feat/psychiatry-identity-without-qr`
3. `feat/sjd-psychiatry-unit-profiles`
4. `feat/sjd-psychiatry-section-fields`
5. `feat/sjd-safety-overlays-falls-fuga-restraint`
6. `feat/psychogeriatrics-udcc-functional-overlay`
7. `feat/psychiatry-mpac-explainable-priorities`
8. `feat/psychiatry-fhir-and-icea-shadow`
9. `feat/sjd-psychiatry-demo-mode`
10. `test/docs-psychiatry-demo-hardening`

## Alcance real de este PR

Este PR implementa el seam inicial SJD psiquiatría de forma acotada:

- documenta alcance, límites y guardrails del demo;
- añade `psych` como especialidad visible;
- añade unidades SJD/UDCC al catálogo operativo;
- mapea esas unidades al perfil común `behavioral-health`;
- refuerza el runtime mínimo de salud mental;
- desactiva QR por defecto en contexto psiquiátrico/salud mental;
- mantiene QR como capacidad futura reactivable por flag explícito;
- añade pruebas mínimas del seam.

Este PR no cambia:

- contratos Zod clínicos principales;
- exportación FHIR;
- payloads o vistas ICEA;
- backend;
- auth/RBAC;
- sync/offline queue;
- dependencias;
- demo fixtures sintéticos de punta a punta.

## Riesgos residuales abiertos tras este PR

- sin unidades y especialidades SJD visibles en runtime, el demo sigue apoyado en costuras genéricas;
- sin campos psiquiátricos mínimos adicionales, el runtime `behavioral-health` actual es insuficiente para adulto, infanto-adolescente y psicogeriatría;
- sin fixtures y demo mode SJD, la narrativa clínica todavía no queda trazada de punta a punta;
- los documentos clínicos SJD siguen siendo una dependencia externa hasta que exista una vía institucional de incorporación o validación fuera de PHI.

## Veredicto documental

Listo como documento de alcance y control de cambios para abrir las ramas funcionales siguientes.

No debe usarse como evidencia de que el demo psiquiátrico ya está implementado.
