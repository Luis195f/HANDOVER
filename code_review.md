# code_review.md

## Objetivo

Checklist de revisión técnica, clínica y arquitectónica para cambios en HANDOVER.

---

## 1. Alcance

- [ ] El cambio resuelve exactamente el objetivo pedido.
- [ ] No hubo expansión innecesaria de alcance.
- [ ] Se declara qué quedó fuera de este cambio.

## 2. Arquitectura

- [ ] Respeta la arquitectura actual del repositorio.
- [ ] No introduce microservicios ni frameworks paralelos.
- [ ] Mantiene el flujo general cliente -> validación -> mapeo -> sync -> cliente FHIR -> servidor/HCE.
- [ ] Reutiliza capas existentes antes de añadir nuevas.

## 3. Contratos de datos y FHIR

- [ ] No rompe shapes de datos sin justificación explícita.
- [ ] Si toca FHIR, mantiene o documenta claramente el contrato.
- [ ] No introduce códigos clínicos hardcodeados cuando existe o debe existir una fuente central.
- [ ] La validación FHIR o equivalente queda cubierta por tests o scripts.

## 4. Sync, queue y red

- [ ] El flujo offline-first sigue siendo coherente.
- [ ] Se diferencian errores reintentables y no reintentables.
- [ ] No se introducen duplicados, loops ni reintentos ambiguos.
- [ ] No se exponen datos sensibles en logs o mensajes.

## 5. Seguridad, PHI y auditoría

- [ ] No se debilita auth, permisos, firma, auditoría o almacenamiento sensible.
- [ ] No se crean fallbacks inseguros silenciosos.
- [ ] Los errores o logs no contienen PHI.
- [ ] La trazabilidad sigue siendo suficiente para revisión o auditoría.

## 6. Perfiles clínicos y runtime

- [ ] Si toca perfiles, se mantiene la lógica de núcleo compartido.
- [ ] No duplica formularios por unidad o especialidad sin justificación excepcional.
- [ ] La precedence entre core, unit packs y overlays es clara.
- [ ] Hay cobertura de tests para flags, visibility y compatibilidad cuando aplica.

## 7. Tipado y mantenibilidad

- [ ] No se introducen `any`, `@ts-ignore` o casts forzados evitables.
- [ ] El cambio mejora o al menos no empeora la claridad del módulo.
- [ ] El cambio es razonablemente reversible.
- [ ] Los helpers nuevos son puros y reutilizables cuando corresponde.

## 8. Pruebas

- [ ] Pasa `pnpm -w typecheck` o equivalente real del repo.
- [ ] Pasa `pnpm -w lint` o equivalente real del repo.
- [ ] Pasa `pnpm -w test` o equivalente real del repo.
- [ ] Si toca FHIR, perfiles, sync, auth o bridge, hay pruebas específicas.

## 9. Documentación

- [ ] Se actualizó documentación relevante si cambió comportamiento real.
- [ ] La documentación describe el estado real y no uno aspiracional.
- [ ] Se explicita impacto, riesgos y límites cuando corresponde.

## 10. Riesgo clínico / operativo

- [ ] El cambio no altera semántica clínica sin justificación.
- [ ] El cambio no empeora la seguridad operativa del pase de turno.
- [ ] Los riesgos residuales quedan declarados con honestidad.

## 11. Veredicto final

Marca una sola opción:

- [ ] Apto para PR
- [ ] Apto con cambios menores
- [ ] No apto para PR

## 12. Resumen obligatorio del revisor

Completar siempre:
- Archivos sensibles tocados:
- Contratos afectados:
- Riesgos residuales:
- Tests ejecutados:
- Docs actualizadas:
- Recomendación final:
