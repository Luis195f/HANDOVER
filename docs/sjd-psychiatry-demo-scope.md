# Demo SJD Psiquiatria: alcance prudente

Estado revisado el 2026-05-09.

## Objetivo

Preparar un demo prudente de HANDOVER + ICEA para salud mental usando el nucleo comun ya existente, sin presentar el repo como solucion cerrada ni abrir formularios paralelos.

## Seam implementado

- las unidades `sjd-a`, `sjd-b`, `sjd-infanto` y `udcc-psychogeriatrics` siguen mapeadas al perfil comun `behavioral-health`;
- el runtime comun de salud mental hace visibles observacion especial, riesgo de caidas, fuga/no retorno, entorno seguro, elementos retirables y continuidad del relevo;
- la contencion aparece solo como evento trazable con autorizacion, revision, vigencia y reevaluacion;
- adulto, infanto-adolescente y psicogeriatria/UDCC mantienen un unico core y solo cambian mediante checklist contextual y copy prudente;
- QR sigue desactivado por defecto en contextos `behavioral-health` / `psych`.

## Variaciones ligeras permitidas

### Adulto

- observacion especial y acompanamiento;
- adherencia o rechazo terapeutico;
- fuga/no retorno;
- entorno seguro;
- reevaluacion del siguiente turno.

### Infanto-adolescente

- acompanamiento;
- comunicacion interna del turno;
- coordinacion con familia o tutor cuando aplique;
- continuidad del retorno seguro y del siguiente relevo.

### Psicogeriatria / UDCC

- basal cognitivo-funcional y cambio respecto al basal;
- supervision requerida y deambulacion supervisada;
- riesgo de caidas;
- deterioro cognitivo-funcional;
- continencia o piel cuando condicionen la continuidad;
- dispositivos o tratamientos retirables;
- ingesta, hidratacion y sueno;
- adherencia terapeutica y reevaluacion del siguiente turno.

## Limites del demo

- un unico formulario;
- sin rutas, pantallas ni flujos nuevos;
- sin campos persistidos nuevos;
- sin cambios en backend, FHIR, ICEA, auth, auditoria u offline queue;
- sin instrucciones operativas para contencion.

## Lectura funcional esperada

El demo debe permitir que el equipo:

- revise parte diario y continuidad del relevo;
- haga visible observacion especial y entorno seguro;
- registre caidas, fuga/no retorno y elementos retirables como riesgos de seguridad;
- deje trazable una medida excepcional sin describir pasos tecnicos;
- cierre pendientes no omitibles para el siguiente turno.

## Veredicto documental

Listo como alcance generico del demo psiquiatrico con un unico runtime `behavioral-health` y variaciones ligeras por checklist contextual.
