# Bedside checklist – contrato y plan (Bloque A)

## Fuente de verdad y llaves actuales
- El esquema Zod `zHandoverBedsideChecklist` define los campos booleanos: `patientIdentityConfirmed`, `allergiesReviewed`, `linesAndDevicesChecked`, `medicationPlanReviewed`, `safetyMeasuresApplied`, `questionsAnswered`; `bedsideNotes` es un string opcional y no impacta la completitud.
- La validación de cierre impide finalizar si `patientIdentityConfirmed` o `allergiesReviewed` están en `false` (regla en `zHandover` superRefine).

## Dónde se intercepta “Finalizar entrega”
- En `HandoverForm`, el handler `handleFinalize` marca `status` como `"final"` y delega en `onSubmit`, que a su vez ejecuta `submitHandover` con los valores actuales.
- `submitHandover` respeta la validación Zod; el modal de cabecera deberá engancharse antes de `handleFinalize` o dentro de su flujo antes de disparar `onSubmit`.

## Definición de completitud del checklist
- **Completo**: todos los campos booleanos anteriores en `true`.
- `bedsideNotes` no cuenta para la completitud.

## Contrato compartido propuesto
- Se agregó `src/screens/components/bedsideChecklist.constants.ts` con:
  - `BEDSIDE_CHECKLIST_BOOLEAN_KEYS` como arreglo `as const` de las llaves booleanas.
  - `BEDSIDE_CHECKLIST_ITEMS` con `key`, `label` y `helper?` para reutilizar en sección y modal.
  - `isBedsideChecklistComplete(values)` para evaluar completitud según las llaves booleanas.

## Plan de bloques siguientes
- **Bloque B (UI modal)**: usar las constantes para renderizar el modal obligatorio al finalizar; interceptar `handleFinalize` para abrir modal y solo continuar si el usuario confirma manualmente cada switch. Impacto: UI de `HandoverForm` y posible lifting de estado del checklist al modal.
- **Bloque C (validaciones UX)**: sincronizar sección y modal usando `BEDSIDE_CHECKLIST_ITEMS`; evitar autocompletar switches, asegurar que la validación Zod existente sigue activa como respaldo. Impacto: sección `BedsideChecklistSection` y handlers de form.
- **Bloque D (tests)**: agregar pruebas de unidad/integ para `isBedsideChecklistComplete`, handlers de finalize y render compartido de ítems. Impacto: nuevos tests en `tests`/`__tests__` sin alterar mapeo FHIR.
