# Demo de Salud Mental: alcance prudente

Estado revisado el 2026-05-10.

## Objetivo

Preparar un demo prudente de HANDOVER + ICEA para salud mental usando el nucleo comun ya existente, sin presentar el repo como solucion cerrada ni abrir formularios paralelos.

## Seam implementado

- las unidades adultas A/B, infanto-adolescente y de psicogeriatria siguen mapeadas al perfil comun `behavioral-health`;
- el runtime comun de salud mental hace visibles observacion especial, seguridad fisica y apoyo para movilidad o traslados cuando aplique, fuga/no retorno, entorno seguro, elementos retirables y continuidad del relevo;
- la contencion aparece solo como evento trazable con autorizacion, revision, vigencia y reevaluacion;
- adulto, infanto-adolescente y psicogeriatria mantienen un unico core y solo cambian mediante checklist contextual y copy prudente;
- QR sigue desactivado por defecto en contextos `behavioral-health` / `psych`.

## Infraestructura de demo reutilizada

- `src/demo/fixtures.ts` concentra el dataset sintetico del modo demo;
- `src/demo/mock-api.ts` responde a `/api/patients`, `Patient/{id}`, `Encounter?...` y `AllergyIntolerance?...` sin tocar backend real;
- `docs/MVP_DEMO.md` sigue siendo el walkthrough generico; este documento fija el seam de salud mental hoy soportado;
- no se conectan materiales locales ni artefactos operativos del centro.

## Variaciones ligeras permitidas

### Adulto

- observacion especial y acompanamiento;
- seguridad fisica y apoyo para movilidad o traslados cuando aplique;
- adherencia o rechazo terapeutico;
- fuga/no retorno;
- entorno seguro y elementos retirables;
- reevaluacion del siguiente turno.

### Infanto-adolescente

- acompanamiento;
- comunicacion interna del turno;
- coordinacion con familia o tutor cuando aplique;
- continuidad del retorno seguro y del siguiente relevo.

### Psicogeriatria

- basal cognitivo-funcional y cambio respecto al basal;
- supervision requerida y deambulacion supervisada;
- riesgo de caidas;
- deterioro cognitivo-funcional;
- continencia o piel cuando condicionen la continuidad;
- dispositivos o tratamientos retirables;
- ingesta, hidratacion y sueno;
- adherencia terapeutica y reevaluacion del siguiente turno.

## Recorridos sinteticos soportados hoy

### 1) Adulto salud mental

- fixture demo sintetico de salud mental adultos A;
- presentacion: continuidad del relevo, observacion especial, seguridad fisica y apoyo para movilidad o traslados cuando aplique, fuga/no retorno, entorno seguro y elementos retirables resguardados;
- no omitir: adherencia o rechazo terapeutico, medicacion del siguiente turno y reevaluacion prioritaria;
- cierre esperado: pendientes claros para el siguiente relevo sin lenguaje punitivo ni ranking de peligrosidad.

### 2) Infanto-adolescente

- fixture demo sintetico infanto-adolescente;
- presentacion: acompanamiento, entorno seguro, elementos retirables antes de cambio de actividad, retorno seguro y coordinacion con tutor cuando aplique;
- no omitir: rechazo terapeutico parcial, continuidad del acompanamiento y cierre del siguiente turno;
- cierre esperado: continuidad relacional y de supervision sin crear formulario paralelo ni instruccion operativa de contencion.

### 3) Psicogeriatria

- fixture demo sintetico de psicogeriatria;
- presentacion: basal cognitivo-funcional, deambulacion supervisada, riesgo de caidas, hidratacion/sueno, adherencia terapeutica y audifono removible resguardado;
- no omitir: supervision requerida, cambio respecto al basal y pendientes del turno siguiente;
- cierre esperado: continuidad funcional y seguridad del entorno sin score psiquiatrico ni IA clinica cerrada.

## Walkthrough recomendado

1. Abrir `demo mode` y filtrar, si hace falta, por la unidad adultos A, la unidad infanto-adolescente o la unidad de psicogeriatria.
2. Mostrar que el listado y el detalle siguen viniendo del seam demo aislado, con datos sinteticos y sin backend operativo.
3. En cada recorrido, enfatizar continuidad del relevo, observacion especial o supervision, seguridad fisica y apoyo para movilidad o traslados cuando aplique, adherencia/rechazo, entorno seguro, elementos retirables y reevaluacion del siguiente turno.
4. Si se menciona contencion, dejarla solo como evento trazable con autorizacion, revision, vigencia y reevaluacion, sin describir pasos operativos.
5. Presentar MPAC solo como prioridades explicables de continuidad subordinadas al juicio enfermero.
6. Cerrar recordando que HANDOVER se muestra aqui como piloto/demo profesional, no como producto production-ready ni clinicamente validado.

## Limites del demo

- un unico formulario;
- sin rutas, pantallas ni flujos nuevos;
- sin campos persistidos nuevos;
- sin cambios en backend, FHIR, ICEA, auth, auditoria u offline queue;
- sin instrucciones operativas para contencion.

## Compatibilidad FHIR e ICEA shadow

- el seam de salud mental no crea un mapper FHIR psiquiatrico ni recursos FHIR especificos nuevos;
- cuando el runtime resuelve `behavioral-health`, la exportacion usa solo costuras ya existentes: `Composition.extension`, `Composition.section[Clinical context]`, la `Observation` contextual y los recursos Core ya presentes segun el dato realmente documentado;
- el copy editorial del runtime, el checklist contextual, `mergeTrace` e `iceaContext` no abren un contrato clinico nuevo ni cambian la gobernanza del payload;
- si el bridge ICEA consume ese Bundle, la proyeccion sigue entrando por el `contextualSignal` versionado ya existente y mantiene `shadow_aggregated_no_individual_score`, sin score individual visible ni lectura nominal bedside.

## Lectura funcional esperada

El demo debe permitir que el equipo:

- revise parte diario y continuidad del relevo;
- haga visible observacion especial y entorno seguro;
- registre seguridad fisica, apoyo para movilidad o traslados cuando aplique, fuga/no retorno y elementos retirables como riesgos de seguridad;
- deje trazable una medida excepcional sin describir pasos tecnicos;
- cierre pendientes no omitibles para el siguiente turno.

## Veredicto documental

Listo como alcance generico del demo de salud mental con un unico runtime `behavioral-health` y variaciones ligeras por checklist contextual.
