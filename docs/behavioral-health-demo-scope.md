# Demo de Salud Mental: alcance prudente

Estado revisado el 2026-08-25.

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

## Ruta primaria por excepciones

La selección demo `Psiquiatria y salud mental` abre una superficie compacta de unidad sobre `PatientList`, no un formulario clínico paralelo. El escenario determinista contiene 40 identidades sintéticas clasificadas mediante un atributo explícito del fixture:

- 32 `unchanged`, visibles como listado compacto y revisables colectivamente sin apertura individual obligatoria;
- 6 `changed`, con relevo breve editable y acceso bajo demanda al formulario completo;
- 2 `critical`, con SBAR determinista local, tres puntos críticos como máximo y check-back de la profesional entrante.

La clasificación nunca se deriva de que falte una nota o evolución. “Sin novedades registradas para este relevo” describe el estado sintético explícito del escenario y no valida valores clínicos actuales.

La revisión colectiva, el relevo breve, el check-back y las atestaciones de unidad se registran como eventos diferenciados durante la sesión demo. Muestran actor y fecha/hora, pero no amplían el payload, auditoría, firma clínica, FHIR ni persistencia. La transferencia clínica persistida continúa en el `HandoverForm` existente.

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

1. Abrir `demo mode` y seleccionar `Psiquiatria y salud mental`.
2. Mostrar los tres grupos y confirmar que los 32 casos `unchanged` no requieren apertura individual.
3. Expandir opcionalmente la lista y registrar la revisión colectiva, sin presentarla como validación clínica ni transferencia formal.
4. Abrir un caso `changed`, revisar la precarga y aceptar el relevo breve sin entrar al formulario completo.
5. Cambiar a la profesional entrante demo, abrir un caso `critical` y registrar el check-back o la necesidad de aclaración.
6. Usar `Ver detalle completo` para demostrar que el Core, firmas, payload y recorrido offline siguen disponibles.
7. Cerrar recordando que HANDOVER se muestra aquí como demo sintética, no como producto production-ready, clínicamente validado o conectado a una HCE.

## Limites del demo

- un unico formulario;
- una superficie de unidad por excepciones dentro del listado existente, sin formulario paralelo;
- sin campos persistidos nuevos;
- sin cambios en backend, FHIR, ICEA, auth, auditoria u offline queue;
- los eventos de revisión colectiva, check-back y atestación de unidad no sobreviven al cierre o recarga de la sesión demo;
- en web no se afirma persistencia offline tras recargar o cerrar la pestaña;
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
