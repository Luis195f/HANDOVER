# Contrato de entrada NEWS2: frecuencia respiratoria entera

## Alcance y estado

Intervención separada de C02, sobre `3568ef5c936a402ccb306db3b84747ff88e1ad0e`.
Rama: `fix/news2-rr-integer-input-contract`.

- NEWS2 RR INPUT CONTRACT: EN IMPLEMENTACIÓN QUIRÚRGICA.
- C02: BLOCKED / NOT_STARTED.
- CLINICAL: NOT_VALIDATED.
- STAGING: NOT_VERIFIED / MANUAL_GATED.
- EXTERNAL-INTEGRATION: NOT_VERIFIED/OFF.
- INSTITUTIONAL: NOT_VERIFIED.

La paridad técnica con RCP no constituye validación clínica. C17 permanece
como dependencia externa no definida; no se infiere ni se declara validado.

## Contrato mínimo

Una FR finita no entera activa una revisión pendiente antes de invocar NEWS2.
El valor permanece en el campo editable: no se redondea, trunca ni sustituye
por una observación anterior. Prefill no devuelve `news2`, `total`,
`anyThree`, `band`, `priority` ni `priorityLabel` para esa entrada.

La salida bloqueada contiene `news2InputState` con
`status: 'not-calculable'` y `reason: 'RR_NON_INTEGER'`, y `rrReview`:

```ts
type RrReview = {
  originalValue: number;
  source: 'fhir' | 'manual' | 'legacy-draft';
  unit?: string;
  observedAt?: string;
  reason: 'RR_NON_INTEGER';
  resolution: 'pending' | 'corrected';
};
```

`originalValue` debe ser finito; cadenas numéricas estrictas se convierten
en número en la frontera, sin conservar el texto. La allowlist descarta
claves adicionales; las unidades se restringen a unidades respiratorias
reconocidas y la fecha opcional a ISO datetime. Nunca se copia la Observation,
sus identificadores, referencias, notas o extensiones a este metadato.

Solo una edición manual que satisface el schema RR existente resuelve la
revisión. Borrar, introducir otro decimal, restaurar un entero sin resolución
manual o introducir un entero fuera del rango no resuelve un bloqueo pendiente.

QRScan permite continuar al formulario. Ambos muestran exactamente:
**NEWS2 no calculable: verificar frecuencia respiratoria**.

## Integración y persistencia

`HandoverForm` controla las invocaciones directas y las entradas a los
consumidores que calculan NEWS2. Durante el bloqueo se omite el objeto de
constantes exclusivamente en esas proyecciones; el formulario conserva sus
valores. Braden, riesgos independientes y sus alertas siguen disponibles.
Los algoritmos de esos consumidores no cambian.

Cada cambio de FR invalida propuestas y cachés asíncronas anteriores, incluso
si luego se vuelve al entero inicial. También se comprueba la revisión antes
de aplicar propuestas o mostrar el cálculo posterior al envío. Un resumen
automático no editado se regenera sin NEWS2 al activar el bloqueo; no se
reescriben narrativas editadas por el profesional.

El borrador existente incorpora únicamente `news2RrReview` con la allowlist
anterior. Se reutiliza la clave SecureStore del formulario; no se introduce
un almacén paralelo. Guardar una entrada bloqueada guarda el borrador local,
sin intentar enviar la FR decimal a través del schema. La restauración extrae
el metadato antes de `reset`; no entra en los valores destinados a FHIR o IA.
Un borrador legacy decimal reconstruye la revisión con fuente `legacy-draft`.
La restauración no reemplaza datos ya editados ni un prefill FHIR bloqueado.

Los identificadores propios del borrador clínico existente no se duplican
en el metadato. Este último no se exporta a FHIR, backend, IA, logs, auditoría
ni mensajes públicos. Solo se muestra el aviso fijo, sin el contenido del metadato.

## Pruebas y límites

La suite `tests/screens/news2-input-contract.spec.tsx` se registra en
`vitest.pilot.config.ts`, dentro del comando obligatorio de coverage CI.
RED inicial: prefill devolvía score/prioridad para 8.5, 11.5 y 20.5; faltaba
el aviso tras borrar. GREEN focal: 38 pruebas, incluyendo QR y HandoverForm
reales, guardado/restauración offline, respuesta backend obsoleta,
allowlist, exportación real FHIR/IA, enteros, Scale 1/2, oxígeno y Braden.
La suite existente de borradores conserva sus 9 pruebas verdes.

No se modifican `news2.ts`, alerts, handoverRisk, summary, ai-degrade,
schemas, mapeadores FHIR, backend, autenticación, auditoría ni staging.
El contrato no consolida las fórmulas duplicadas de prefill: eso pertenece
a C02, todavía bloqueada. Tampoco redefine otros valores inválidos, selecciona
Scale 2 ni valida clínicamente el calculador.

## Validación local del 23 de septiembre de 2026

- Suite focal: 38/38; suite existente de borradores: 9/9.
- `pnpm -w quality:pilot:ci`: PASS. Incluye typecheck, lint:ci,
  gate:any-sensitive, test:pilot:coverage:ci (63 suites, 494 pruebas),
  E2E Expo Web real (1 prueba) y validate:fhir (7 fixtures).
- Typecheck, lint:ci, gate:any-sensitive y validate:fhir también se ejecutaron
  individualmente con resultado PASS; `git diff --check`: PASS.
- El primer coverage detectó timeout del import pesado de HandoverForm y un
  bucle de invalidación por recreación del objeto form en el arnés existente.
  Se separó la invalidación por cambio de paciente del ciclo de suscripción y
  se dio 20 s a la prueba de integración que importa la pantalla por primera vez.
  No se modificaron las suites existentes ni umbrales/configuración de coverage.
- `pnpm -w test:unit`: **FAIL con excepción baseline**, no verde:
  1074 pruebas pasan, 3 fallan y 1 se omite. Comparación exacta de nombre y
  bloque de error con el registro conservado `news2-scale2-unit-final.log`
  del 22 de septiembre; coinciden los tres y no hay nuevos fallos:
  - demo-mode: esperaba 3 recorridos y recibió 40 (`demo-mode.spec.ts:72`).
  - BedsideChecklistSection: no encuentra el accessibilityLabel (`:79`).
  - unitConfig: esperaba bloques pediátricos > 0 y recibió 0 (`:297`).

El comando solicitado `pnpm -w validar:fhir` no existe; el equivalente real
`pnpm -w validate:fhir` pasa. No se cambia ningún script para ocultarlo.

Presupuesto revisado: 5 archivos productivos, 234 líneas productivas cambiadas
(altas + bajas); 1 suite de 337 líneas, 1 registro de CI y este documento,
contabilizados separadamente: 8 archivos totales. No se superan 400 líneas
productivas. Publicación y revisión remota se informan en el PR; los controles
locales no acreditan validación clínica ni verificación institucional.
