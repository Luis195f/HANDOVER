# Recortes UI/UX: simplificación y eliminación de duplicidades

## Campos canónicos vs legado

- **Medicación**
  - Canónico: `medications[]`.
  - Legado aceptado: `meds` (texto libre).
  - Normalización: si llega solo `meds`, se deriva a `medications[]` al parsear. Si `medications[]` tiene datos y `meds` está vacío, se deriva `meds` para compatibilidad visual legacy.

- **Riesgos**
  - Canónico: `risksStructured[]`.
  - Legado aceptado: `risks[]` (array de strings) y `risks` (flags históricos).
  - Normalización: `risks[]` se convierte a `risksStructured[]` por tipo canónico.

- **SBAR/cierre**
  - Canónico de cierre: `closingSummary`.
  - Legado aceptado: `sbarFullText`.
  - Normalización: si `closingSummary` está vacío y `sbarFullText` tiene contenido, se copia al canónico. Si `sbarFullText` está vacío y `closingSummary` existe, se refleja en legacy.
  - IA SBAR: ahora la generación/refinado llena `closingSummary` para evitar doble fuente de verdad.
  - SBAR local: al abrir un formulario nuevo con precarga finalizada y sin SBAR previo, `generateSbarSummary` genera una única versión determinística sin red ni IA. La versión existente o editada no se sobrescribe; `Regenerar SBAR` confirma antes de reemplazar cambios profesionales.
  - Procedencia demo: el resumen indica que se basa en datos sintéticos y que no constituye inferencia clínica de IA.

## Dictado y reescritura

- La ruta de dictado móvil está implementada para iOS/Android mediante grabación Expo y el endpoint configurado; su funcionamiento end-to-end en dispositivo real, con backend y permisos, no fue verificado en esta corrección.
- Expo Web no está soportado. La escritura permanece disponible y el primer intento de dictado muestra un único aviso; no se repiten errores rojos junto a cada campo ni se incorpora Web Speech API.
- La reescritura SBAR por IA sigue siendo opcional. Sin backend configurado, sus acciones permanecen explícitamente desactivadas y no bloquean apertura, edición, guardado, cola ni finalización.

- **Glucosa**
  - Unidad UI única: **mg/dL**.
  - Legado aceptado: `glucoseMmolL`.
  - Normalización: si llega solo mmol/L, se convierte a mg/dL (factor 18.0182). Se mantiene `glucoseMmolL` derivado para compatibilidad de payload.

## Feature flag `HIDE_LEGACY_FIELDS`

- Flag en `src/config/flags.ts` con default `false`.
- Cuando `HIDE_LEGACY_FIELDS=true`:
  - Se oculta `meds` (texto libre legado) en UI.
  - Se oculta `sbarFullText` en UI.
  - Se elimina la doble entrada de glucosa en mmol/L en UI (solo mg/dL visible).
- Compatibilidad: aunque ocultos, los campos legado siguen siendo aceptados en payload/drafts y normalizados al modelo canónico.

### Plan de despliegue sugerido

1. Activar en preproducción por unidad/piloto (`hideLegacyFields=true` en `HANDOVER_UNITS_JSON`).
2. Monitorear tasa de validación/sincronización y tiempo de registro.
3. Activar globalmente via `EXPO_PUBLIC_HIDE_LEGACY_FIELDS=true`.
4. Mantener aceptación de payload legado para clientes antiguos y borradores persistidos.

## Política de glucosa y conversión

- **Entrada clínica principal:** mg/dL.
- **Conversión automática:**
  - mmol/L → mg/dL: `mg/dL = mmol/L * 18.0182`.
  - mg/dL → mmol/L derivado para compatibilidad (solo datos).
- **Rangos de validación:** mg/dL `[18..1000]` para cubrir compatibilidad completa del rango legacy mmol/L `[1..55]` tras conversión.
- **FHIR/UCUM:** mapeo consistente a UCUM `http://unitsofmeasure.org` con unidad/código `mg/dL` usando el valor normalizado canónico.
- **No doble carga:** una única entrada en UI, sin duplicar captura manual.
