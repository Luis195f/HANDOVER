# code_review.md

## Objetivo

Checklist corto de revisión técnica, clínica y arquitectónica para HANDOVER.

## 1. Alcance

- [ ] Resuelve exactamente la tarea pedida.
- [ ] No expande alcance sin justificación.
- [ ] Declara explícitamente que no fue tocado.

## 2. Arquitectura

- [ ] Respeta React Native / Expo + TypeScript y Django + DRF.
- [ ] Mantiene Core + UPP + SOP + MPAC + ICEA+ sin formularios paralelos.
- [ ] No abre microservicios, backend paralelo ni flujos alternos.
- [ ] Mantiene UI -> Zod -> FHIR -> queue/sync -> fhir-client -> servidor FHIR/HCE.

## 3. Contratos sensibles

- [ ] No rompe contratos HTTP, FHIR, runtime, auth, RBAC, auditoría o bridge sin evidencia y docs.
- [ ] Si toca perfiles, la precedence y compatibilidad quedan claras y probadas.
- [ ] No expone PHI ni introduce fallbacks inseguros.

## 4. Calidad del cambio

- [ ] El cambio es pequeño, entendible y reversible.
- [ ] Reutiliza helpers, tipos y costuras existentes.
- [ ] No introduce `any`, `@ts-ignore`, `@ts-nocheck` o casts forzados evitables.

## 5. Validación

- [ ] Ejecuta validaciones proporcionales al seam tocado.
- [ ] En módulos sensibles incluye typecheck, lint, tests relevantes y validación FHIR si aplica.
- [ ] El resultado real de las pruebas queda declarado.

## 6. Documentación

- [ ] Actualiza documentación si cambia comportamiento clínico, contrato, runtime o seguridad.
- [ ] La documentación describe el estado real, no uno aspiracional.

## 7. Veredicto

Marca una sola opción:

- [ ] Listo para PR
- [ ] Listo con reservas
- [ ] No listo para PR

## Resumen obligatorio

- Archivos sensibles tocados:
- Contratos afectados:
- Riesgos residuales:
- Pruebas ejecutadas:
- Documentación actualizada:
- Recomendación final:
