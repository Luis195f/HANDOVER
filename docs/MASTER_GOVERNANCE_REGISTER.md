# MASTER_GOVERNANCE_REGISTER

> Estado del documento
> - Estado: `implemented`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: árbol actual del repo, `git tag --list`, `git log --oneline --decorate -n 15`, `git for-each-ref --sort=-committerdate`, `.github/workflows/*`, `backend/api/urls.py`, `backend/api/icea_ops.py`.
> - Riesgos o lagunas abiertas: este registro consolida el estado técnico verificable del repo, pero no sustituye evidencia operativa externa del piloto, actas clínicas, licencias NNN ni disponibilidad del upstream ICEA+.

## 1. Propósito y reglas de estado

Este documento es el registro maestro único de gobierno técnico del repo para evitar deriva documental. Solo incluye afirmaciones verificables en código, tests, docs o refs Git locales.

Estados usados en este registro:

- `implemented`: capacidad visible y respaldada por código y/o tests en el repo actual.
- `pilot`: capacidad real de repo, pero con límites operativos, regulatorios o de despliegue aún abiertos.
- `provisional`: costura real pero incompleta, dependiente de flags o de evidencia externa para considerarse estable.
- `demo`: superficie explícitamente etiquetada como demo o fixture.
- `pending`: trabajo no implementado o gap material aún abierto.
- `legacy-unverified`: narrativa heredada o etiqueta histórica no corroborada en este corte.

## 2. Baseline técnico verificable

| Bloque | Estado | Fuentes verificables | Nota de gobierno |
| --- | --- | --- | --- |
| Arquitectura backend Django-only | `implemented` | `docs/overview-architecture.md`, `backend/api/urls.py`, `backend/api/views.py` | No hay FastAPI operativa en la API clínica principal. |
| Pipeline clínico principal UI -> Zod -> FHIR -> queue/sync -> backend | `implemented` | `AGENTS.md`, `docs/clinical-profiles-framework.md`, `src/validation/schemas.ts`, `src/lib/fhir-map.ts`, `src/lib/sync.ts`, `backend/api/views.py` | Sigue siendo la costura obligatoria del producto. |
| HANDOVER como capa operativa principal | `implemented` | `docs/clinical-profiles-framework.md`, `docs/overview-architecture.md`, `docs/icea-integration.md` | La operación clínica vive en HANDOVER; ICEA no reemplaza el relevo. |
| ICEA+ como capa analítica agregada y observacional | `pilot` | `docs/clinical-profiles-framework.md`, `docs/icea-integration.md`, `backend/api/icea_clinical_feedback.py` | Debe mantenerse prudente, no punitiva y no nominal. |
| NNN con BYO-license | `pilot` | `README.md`, `docs/fhir-and-interoperability.md`, `docs/qa-mdr-plan-nnn-icea.md`, `src/catalogs/governedCatalog.ts`, `backend/api/views_catalogs.py` | El repo no embebe corpus licenciados completos. |
| CI y gates sensibles | `implemented` | `package.json`, `.github/workflows/ci.yml`, `.github/workflows/django.yml`, `docs/testing-and-ci.md` | El job principal de `CI` es bloqueante en este corte. |
| Deploy web staging | `pilot` | `.github/workflows/deploy-staging.yml`, `Dockerfile`, `docker-compose.yml`, `Procfile`, `docs/DEPLOY.md` | La web estática sí está automatizada; el backend sigue como pieza separada. |
| Backup/restore drill y rehearsal operativo | `pilot` | `.github/workflows/backup.yml`, `scripts/backup-db.sh`, `scripts/backup-media.sh`, `scripts/restore-db.sh`, `scripts/restore-media.sh`, `scripts/release-rehearsal.ps1`, `docs/backup-restore-drill.md`, `docs/release-rehearsal.md` | El repo deja backup cifrado y restore scratch-first verificable, pero no un DR full-stack automatizado. |

## 3. Estado documental del repo

| Documento o bloque | Estado | Fuente de verificación | Comentario |
| --- | --- | --- | --- |
| `README.md` | `pilot` | archivo actual + `git tag --list` + workflows | Armonizado para no presentar `v0.4.0-rc.1` como release verificado. |
| `CHANGELOG.md` | `legacy-unverified` | archivo actual + `git tag --list` | Conserva narrativa heredada de RC no respaldada por tag Git local. |
| `RELEASE_NOTES.md` | `legacy-unverified` | archivo actual + `git tag --list` | Se mantiene como borrador útil, no como publicación confirmada. |
| `docs/overview-architecture.md` | `implemented` | archivo actual + `backend/api/urls.py` | Coherente con Django-only. |
| `docs/security-and-auth.md` | `implemented` | archivo actual + `backend/security/*` + `backend/api/views.py` | Respaldado por código y tests sensibles. |
| `docs/fhir-and-interoperability.md` | `pilot` | archivo actual + mappers/tests FHIR | Compatible con estado real NNN/FHIR y sus límites. |
| `docs/icea-integration.md` | `pilot` | archivo actual + `backend/api/icea*.py` + tests | Deja límites del upstream y de piloto explícitos. |
| `docs/icea-etl.md` | `implemented` | archivo actual + `backend/api/views.py` + tests ETL | ETL read sigue siendo la vía autorizada para PHI. |
| `docs/testing-and-ci.md` | `implemented` | archivo actual + `package.json` + workflows | Ajustado al estado real del runner y gates. |
| `docs/DEPLOY.md` | `pilot` | archivo actual + deploy workflow + `Procfile` | No vende un full-stack automatizado que el repo no tiene. |
| `docs/QMS_HANDOVER.md` | `provisional` | archivo presente en repo | Sigue siendo referencia regulatoria útil, pero no fue revalidado línea por línea en este corte documental. |
| `docs/MDR_Anexo_II_HANDOVER.md` | `provisional` | archivo presente en repo | Útil como baseline regulatorio; requiere mantenimiento continuo separado del registro maestro. |
| `docs/MDR_traceability_matrix.md` | `provisional` | archivo presente en repo | No sustituye la trazabilidad operacional del piloto NNN + ICEA. |
| `docs/qa-mdr-plan-nnn-icea.md` | `pilot` | archivo actual + tests/docs NNN/ICEA | Alineado con una conversación seria de piloto, no con cierre MDR total. |
| `docs/traceability-matrix-nnn-icea.md` | `pilot` | archivo actual + código/tests citados | Sigue siendo matriz útil, pero no reemplaza este registro maestro. |

## 4. Releases, versionado y ramas verificables

### 4.1 Releases y versionado

| Elemento | Estado | Evidencia | Nota |
| --- | --- | --- | --- |
| Tag Git `v0.2.0-rc.0` | `implemented` | `git tag --list` | Único tag verificable localmente en este corte. |
| Etiqueta documental `v0.4.0-rc.1` | `legacy-unverified` | `CHANGELOG.md`, `RELEASE_NOTES.md`, ausencia en `git tag --list` | No debe presentarse como release publicado. |
| `package.json` version `1.0.0` | `implemented` | `package.json` | Metadato de build, no fuente de verdad del release piloto. |
| `app.config.ts` version `1.0.0` | `implemented` | `app.config.ts` | Igual que arriba: build metadata, no release tag. |

### 4.2 Convención de ramas activas/recientes observables

| Convención observada | Estado | Evidencia | Nota |
| --- | --- | --- | --- |
| `main` | `implemented` | `git for-each-ref`, `git log --decorate` | Rama base visible y apuntando al mismo commit que `origin/main` en este corte. |
| `docs/*` | `implemented` | `docs/master-governance-register-hardening`, `origin/docs/django-only-docs-refresh` | Se usa para trabajo documental real. |
| `fix/*` | `implemented` | `fix/auth-redirect-intentfilters`, `origin/fix/post-merge-audit-icea-and-pr1-7` | Convención activa para correcciones. |
| `chore/*` | `implemented` | `chore/add-dockerignore`, `chore/settings-backend-update` | Convención activa para mantenimiento. |
| `codex/*` | `implemented` | refs remotas `origin/codex/*` | Convención visible para ramas generadas por Codex. |
| `dependabot/*` | `implemented` | múltiples refs remotas `origin/dependabot/*` | Convención activa para updates automáticos. |
| `stabilization/*` | `implemented` | `origin/stabilization/merge-zip` | Convención observada, no necesariamente frecuente. |

## 5. Prompts y workstreams corroborables

| Frente | Estado | Dependencia / entregable | Fuentes verificables | Nota de gobierno |
| --- | --- | --- | --- | --- |
| Prompt 12: observabilidad operativa HANDOVER ↔ ICEA | `implemented` | Endpoints agregados `/api/icea/ops/*`, estados honestos `healthy/degraded/backlog/stale/failed`, UI admin/supervisor y tests de contrato | `backend/api/urls.py`, `backend/api/icea_ops.py`, `backend/api/tests/test_icea_ops_api.py`, `src/lib/admin-api.ts`, `tests/admin-api.spec.ts`, `tests/AdminDashboardScreen.spec.tsx`, `tests/screens/SupervisorDashboard.spec.tsx`, `docs/icea-integration.md` | Implementado en el repo; no equivale a una garantía sobre la disponibilidad real del upstream ICEA+. |
| Prompt 13: armonización documental y registro maestro | `implemented` | Corrección de deriva de release/versionado, encabezados de estado ligeros y este registro maestro único | `README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `docs/MASTER_GOVERNANCE_REGISTER.md`, docs operativos tocados en este corte | Cierra la parte documental del seam verificado, sin inventar releases ni pasado. |
| Workstream reciente: endurecimiento de contratos ops ICEA | `implemented` | Contratos y disabled states de observabilidad | `git log` commit `5d7ae37b`, `backend/api/icea_ops.py`, `backend/api/tests/test_icea_ops_api.py` | Corroborable por commit y código real. |
| Workstream reciente: consistencia de CI, deploy y empaquetado | `implemented` | CI/deploy/docs de empaquetado | `git log` commit `ea50d5dd`, `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, `docs/DEPLOY.md` | Corroborable por commit y workflows. |
| Workstream reciente: hardening preproducción y release rehearsal | `pilot` | Backup cifrado por defecto, restore scratch-first, smoke sintético y runbooks operativos | `.github/workflows/backup.yml`, `scripts/backup-db.sh`, `scripts/restore-db.sh`, `scripts/release-rehearsal.ps1`, `scripts/perf-smoke.py`, `docs/backup-restore-drill.md`, `docs/release-rehearsal.md` | Añade disciplina operativa real sin prometer rollback full-stack fuera del repo. |
| Workstream reciente: señales contextuales case-mix hacia ICEA | `implemented` | Proyección contextual en contrato ICEA | `git log` commit `41f47838`, `docs/icea-integration.md`, `backend/api/icea_payload_mapper.py` | Mantener lectura prudente; no convertir en causalidad clínica. |
| Workstream reciente: first wave de unit profile packs | `pilot` | Packs operativos por unidad y regresión de perfiles | `git log` commit `52ed29d1`, `docs/profile-architecture.md`, `docs/profile-rollout-playbook.md`, fixtures de perfiles en `tests/fixtures/fhir/*` | Real en repo, pero sigue dentro de un rollout clínico progresivo. |

## 6. Registro ligero de decisiones verificables

| ID | Decisión verificable | Estado | Fuentes | Comentario |
| --- | --- | --- | --- | --- |
| D-001 | Django/DRF es la única capa API clínica operativa del repo. | `implemented` | `docs/overview-architecture.md`, `backend/api/urls.py`, `backend/api/views.py` | No reintroducir backend paralelo. |
| D-002 | HANDOVER es la intervención operativa principal; ICEA+ queda como capa analítica agregada, prudente y no punitiva. | `implemented` | `docs/clinical-profiles-framework.md`, `docs/icea-integration.md`, `backend/api/icea_clinical_feedback.py` | Esta tesis debe preservarse en documentación y UX. |
| D-003 | La observabilidad operativa de supervisor/admin usa endpoints agregados `/api/icea/ops/*`, no dashboards ricos en PHI. | `implemented` | `backend/api/urls.py`, `backend/api/icea_ops.py`, `docs/icea-integration.md` | Reduce exposición y evita panel nominal. |
| D-004 | El release piloto se gobierna por tag Git real + release notes, no por `package.json` ni `app.config.ts`. | `implemented` | `README.md`, `docs/DEPLOY.md`, `package.json`, `app.config.ts`, `git tag --list` | Esta decisión corrige la deriva documental observada. |
| D-005 | Los catálogos NNN completos permanecen en modo BYO-license. | `implemented` | `README.md`, `docs/fhir-and-interoperability.md`, `src/catalogs/governedCatalog.ts`, `backend/api/views_catalogs.py` | No se debe prometer licencia o corpus embebido inexistente. |

## 7. Dependencias materiales y límites abiertos

| Frente | Estado | Qué depende de evidencia externa o configuración | Fuentes verificables |
| --- | --- | --- | --- |
| Catálogos NNN completos | `provisional` | Licencia y datasets completos fuera del repo | `README.md`, `docs/fhir-and-interoperability.md`, `docs/qa-mdr-plan-nnn-icea.md` |
| Bridge ICEA enriquecido y status remoto | `provisional` | `ICEA_BRIDGE_MODEL_ID`, `ICEA_BRIDGE_STATUS_PATH` y disponibilidad upstream | `docs/icea-integration.md`, `backend/api/icea_bridge_service.py` |
| Bedside `patient-risk` | `pilot` | Flags de despliegue y gobierno clínico local | `docs/icea-integration.md`, `backend/api/views_icea_bridge.py`, `backend/api/icea_clinical_feedback.py` |
| Deploy backend full-stack automatizado | `pending` | El repo no trae `docker-compose` propio para Django | `docs/DEPLOY.md`, `Procfile` |
| DR full-stack y rollback del backend fuera de staging web | `pending` | El repo solo cubre restore scratch-first y rollback documental de la web estática | `docs/backup-restore-drill.md`, `docs/release-rehearsal.md`, `Procfile` |
| Cierre regulatorio MDR/QMS total | `pending` | Requiere evidencia externa, operación del piloto y revisión QMS formal | `docs/QMS_HANDOVER.md`, `docs/MDR_Anexo_II_HANDOVER.md`, `docs/qa-mdr-plan-nnn-icea.md` |

## 8. Riesgos abiertos de gobierno técnico

- La mayor deriva corregida en este corte era presentar `v0.4.0-rc.1` como si fuera un release verificado cuando no existe tag Git local correspondiente.
- Los artefactos regulatorios (`QMS`, `MDR Annex II`, `MDR traceability`) siguen siendo útiles, pero necesitan mantenimiento separado para no quedarse como fotografías estáticas del repo.
- La observabilidad de Prompt 12 está implementada en el repo, pero nunca debe reinterpretarse como monitorización nominal de personas, evaluación individual o prueba de SLA del upstream ICEA+.
- La capa NNN sigue dependiendo de licencias externas si se quiere salir del modo placeholder/BYO-license.

## 9. Uso de este registro

Cuando un documento operativo entre en conflicto con este registro, la corrección debe hacerse contra el código, los tests y las refs Git actuales antes de actualizar ambos. No crear registros maestros paralelos ni duplicar matrices con estados distintos.
