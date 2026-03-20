# Playbook de rollout clínico y gate de reanudación

Estado revisado el 2026-03-20.

Este playbook cierra la tanda PRE-10, PRE-11, PRE-12 y PRE-13 sobre la arquitectura real del repo: formulario único React Native/Expo + TypeScript, backend Django/DRF, transacción FHIR clínica, lectura ETL desde `HandoverBundleRecord` y side effects ICEA+ desacoplados. No autoriza activar todo el catálogo por defecto ni abrir rutas paralelas.

## Objetivo operativo

- activar perfiles y overlays por oleadas pequeñas, con comité enfermero y rollback explícito;
- usar la misma evidencia de regresión para frontend, export FHIR y contrato contextual ICEA+;
- dejar un gate inequívoco antes de retomar prompts posteriores de la serie.

## Gate PRE-13 de reanudación

Solo se autoriza retomar prompts posteriores cuando queden en verde, sin cambios pendientes, estos gates reales del repo:

```bash
pnpm -w quality:pilot
pnpm -w test:smoke:forms
pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend/api/tests/test_icea_bridge.py
```

Además, en CI deben quedar verdes:

- `.github/workflows/ci.yml`
- `.github/workflows/django.yml`

Cobertura cerrada por este gate:

- registry UPP/SOP y normalización legacy -> canónica;
- merge conservador Core < UPP < SOP y guardrails de `hiddenSections` / `visibility`;
- MPAC y prioridad visible;
- export FHIR contextual (`Composition.extension`, `Clinical context`, `Observation` contextual);
- contrato contextual ICEA+ (`payload_json.contextualSignal` y `rows[].lineage.contextual_signal`);
- validación FHIR sobre fixtures representativas en `tests/fixtures/fhir/*.json`.

Dependencias que quedan desbloqueadas cuando este gate está verde:

- nuevas PRE que se apoyen en el catálogo maestro de perfiles;
- cambios posteriores sobre activación progresiva por unidad;
- trabajo posterior sobre explotación analítica/operativa de contexto FHIR e ICEA+ ya versionado;
- endurecimiento de QA y rollout piloto sin reabrir compatibilidad base.

## Fixtures y evidencia mínima por oleada

Las fixtures representativas que deben mantenerse válidas y versionadas son:

- `uci-adulto-contextual-bundle.json`
- `hospitalizacion-general-medicina-interna-contextual-bundle.json`
- `urgencias-contextual-bundle.json`
- `oncologia-eoprop-ia-contextual-bundle.json`
- `contextual-clinical-context-bundle.json` como regresión adicional de UCI especializada + neuro

Estas fixtures son evidencia de contrato, no activación productiva automática.

## Rollout por oleadas

### Oleada 0: catálogo y shadow mode

- Mantener `HANDOVER_PROFILE_ACTIVATION_JSON` vacío o con activaciones de laboratorio controladas.
- Validar con comité enfermero que labels, quick-picks, secciones visibles y señales de prioridad sean clínicamente comprensibles.
- No activar overlays registry-only en producción por conveniencia.

### Oleada 1: piloto interno por unidad base

- Activar solo un UPP por unidad piloto aprobada: `critical-care`, `general-inpatient`, `emergency`, `ambulatory`.
- Validar al menos un circuito real por unidad con enfermería referente:
  - UCI adulto
  - Medicina interna / hospitalización general
  - Urgencias
  - Oncología / hospital de día con `onc`
- Recolectar evidencia mínima:
  - composición FHIR exportada sin drift;
  - prioridad visible útil para relevo, sin ruido clínico excesivo;
  - bridge ICEA+ persistiendo estado sin bloquear la transacción clínica.

### Oleada 2: overlays pilot-ready aprobados

- Activar solo overlays `wave-1` con UPP compatible ya activo y evidencia local previa.
- Revisar por comité:
  - foco clínico del overlay;
  - ausencia de campos ocultos reabiertos por error;
  - señales MPAC/priority UI alineadas con la práctica del servicio.
- Si se activa un overlay, documentar unidad, fecha, responsables y criterio de rollback.

### Oleada 3: ampliación prudente

- Replicar únicamente en unidades equivalentes después de dos tandas sin incidentes de contrato.
- Mantener `criticalEmergency`, `pedsSubspecialties`, `ophthalEnt`, `plasticsBurns` y `transplant` en `pilot-off` salvo aprobación clínica explícita y evidencia específica.

## Criterios de activación segura

- El UPP base está ya validado en esa unidad o una equivalente.
- No existe drift entre runtime visible, payload FHIR exportado y payload contextual ICEA+.
- La unidad entiende qué señales son explicativas y cuáles no implican causalidad ni score clínico definitivo.
- El rollback se puede aplicar solo ajustando la activación, sin migraciones ni cambios de contrato.

## Señales stop/go

Go:

- Las suites del gate PRE-13 pasan en local y CI.
- El comité enfermero valida comprensión y utilidad del contexto visible.
- No aparecen errores persistentes `failed/stale` del bridge no aceptados por operación.
- El ETL sigue leyendo el bundle clínico persistido sin depender del bridge.

Stop:

- Una activación reabre campos ocultos o cambia visibilidad protegida.
- MPAC/prioridad visible introduce ruido clínico o escalado injustificado sostenido.
- La `Clinical context` de FHIR o `contextualSignal` de ICEA+ divergen del runtime activo.
- Se requiere activar overlays no aprobados para “compensar” huecos del UPP base.

## Rollback

- Quitar la activación problemática de `HANDOVER_PROFILE_ACTIVATION_JSON`.
- Mantener el catálogo maestro intacto; no borrar packs por un incidente de rollout.
- Repetir `pnpm -w quality:pilot`, `pnpm -w test:smoke:forms` y `pytest ... test_icea_bridge.py` antes de reabrir la unidad.
- Si el incidente afectó operación clínica, conservar la evidencia FHIR/ICEA+ emitida y anotar fecha, unidad y decisión del comité.

## Riesgos remanentes honestos

Listo para merge/piloto:

- regresión reproducible sobre perfiles base, overlays pilot-ready ya cableados, export FHIR contextual y contrato contextual ICEA+;
- gate explícito de reanudación y fixtures representativas compartidas entre frontend y backend;
- rollback operativo por activación, sin reescritura arquitectónica.

Todavía no listo para producción real amplia:

- falta validación por comité enfermero y evidencia de campo por cada unidad/overlay que quiera activarse;
- el upstream ICEA+ sigue sin endpoint real de status de score, por lo que el estado local visible continúa siendo la fuente operativa;
- la semántica NNN/terminológica sigue siendo piloto-grade y BYO-license;
- el catálogo maestro contiene packs `registry-only` que no deben interpretarse como aprobados para despliegue productivo.
