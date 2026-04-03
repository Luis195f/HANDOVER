# Security Policy

## Alcance

La superficie operativa de HANDOVER incluye frontend Expo/React Native, backend Django/DRF, contratos FHIR, auth OIDC/JWT, RBAC, auditoría y flujos offline-first. Trata cualquier hallazgo en esas áreas como sensible.

## Cómo reportar

- No abras issues públicos con detalles explotables, PHI, tokens, secretos ni payloads clínicos reales.
- Usa un canal privado del repositorio o contacto directo con el mantenedor antes de cualquier divulgación pública.
- Si el hallazgo afecta datos clínicos o trazabilidad, incluye impacto, pasos de reproducción mínimos y versión/commit afectado, pero siempre con datos sintéticos.

## Reglas mínimas para reportes

- Nunca adjuntes PHI real.
- Nunca compartas credenciales activas.
- Indica si el hallazgo afecta autenticación, autorización, FHIR, cola offline, firma, auditoría o CI/CD.

## Soporte

La referencia técnica vigente para triage es `main` y la documentación de gobierno en `AGENTS.md`, `docs/MASTER_GOVERNANCE_REGISTER.md` y `docs/clinical-profiles-framework.md`.
