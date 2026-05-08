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
- identificación por QR desactivada por defecto para contextos resueltos como `behavioral-health` / `psych`, incluyendo unidades SJD/UDCC y unidades custom que lleguen por `UNITS_CONFIG`;
- QR reactivable únicamente mediante `EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN=true`;
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

- QR no es flujo principal en psiquiatría/salud mental; queda como capacidad opcional o futura, detrás de flag, desactivada por defecto en el recorrido psiquiátrico.
- La identificación principal del demo debe apoyarse en censo/listado de unidad, búsqueda manual, ubicación funcional, cama/planta o identificador institucional, no en QR.
- La app no debe exponer información a familiares; solo registrar coordinación interna cuando proceda.
- La contención mecánica no debe describirse con instrucciones operativas detalladas; el demo solo puede mostrar estado, autorización, revisiones, trazabilidad y referencia a protocolo local.
- No deben mostrarse rankings de “peligrosidad”.
- Las prioridades visibles deben expresarse como continuidad, observación, riesgo de omisión, cambio respecto a basal o necesidad de coordinación.
- No deben generarse recomendaciones clínicas autónomas; solo checklist, recordatorios, síntesis SBAR y continuidad de turno.

## Insumos institucionales y confidencialidad

Este repositorio no incorpora, enumera ni reproduce documentación interna de instituciones sanitarias. Cualquier documento local, protocolo, cronograma, pauta operativa o material institucional que pudiera orientar una demo debe tratarse como insumo confidencial externo, sujeto a autorización formal, anonimización/saneamiento y revisión institucional antes de cualquier uso.

Para efectos del demo, solo se permite usar datos sintéticos y descripciones funcionales genéricas. No deben incluirse nombres de documentos internos, extractos, capturas, adjuntos ni contenido operativo local en el repositorio, PRs, issues, documentación pública o materiales de presentación.

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
- desactiva QR por defecto en contexto psiquiátrico/salud mental, incluso cuando ese contexto se resuelve por `UNITS_CONFIG` y no solo por IDs SJD hardcodeados;
- mantiene QR como capacidad futura reactivable solo mediante `EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN=true`;
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
