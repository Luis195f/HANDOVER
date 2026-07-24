# Revalidación de gaps prepiloto — 2026-07

Fecha de ejecución: 2026-07-24

Repositorio: `Luis195f/HANDOVER`

Rama evaluada: `audit/prepilot-gap-revalidation-2026-07`

HEAD exacto: `49a2052774b1d20ffcfc60c1579019bc6e1fe41b`

## Veredicto

**NOT READY**

El árbol actual conserva la arquitectura obligatoria y los gates estáticos, unitarios, FHIR y backend terminan satisfactoriamente. Sin embargo, hay dos P0 observados que impiden cerrar el prepiloto:

1. Las rutas autenticadas de lectura de pacientes pueden responder datos `DemoPatient` con HTTP 200 cuando FHIR no está disponible, también fuera de un demo mode explícito.
2. El gate denominado E2E no interactúa con la aplicación Expo: cada prueba reemplaza la página por un HTML stub mediante `page.setContent(STUB_HTML)`.

El segundo hallazgo no prueba que la app real falle; prueba que el gate actual no aporta la evidencia de navegación, login, formulario y cierre que afirma aportar. El primero sí es comportamiento runtime clínico actual y puede ocultar una caída de FHIR detrás de pacientes sintéticos aparentemente válidos.

No se modificó código, configuración, contrato ni test alguno para corregir estos hallazgos.

## Estado Git y base evaluada

| Evidencia | Resultado |
|---|---|
| `git status --short` inicial | limpio |
| Rama | `audit/prepilot-gap-revalidation-2026-07` |
| HEAD | `49a2052774b1d20ffcfc60c1579019bc6e1fe41b` |
| `main` | mismo HEAD |
| `origin/main` | mismo HEAD |
| `git diff --name-only main...HEAD` | vacío |
| Tags locales | únicamente `v0.2.0-rc.0` |
| Commit más reciente | `fix(icea): reject individual score material across response aliases (#804)` |

Por tanto, la revalidación se hizo sobre el estado actual de `main`, sin delta funcional propio de la rama de auditoría.

## Criterio de clasificación

- **OBSERVADO**: comprobado directamente en código, documento, salida de comando o artefacto local.
- **INFERIDO**: conclusión razonable desde evidencia observada, sin ejecución completa del escenario.
- **NO VERIFICADO**: depende de entorno, credenciales, infraestructura, dispositivo o ensayo no ejecutado.
- **P0**: bloquea demo/prepiloto.
- **P1**: debe cerrarse antes de RC institucional.
- **P2**: puede esperar a post-demo.
- **NO-ACTION**: ya resuelto, correctamente acotado o no relevante para este cierre.

## Gates ejecutados

| Gate | Exit code | Resultado | Evidencia / causa concreta |
|---|---:|---|---|
| `pnpm install --frozen-lockfile` | 0 | PASS | Lockfile vigente; no se cambió `pnpm-lock.yaml` ni se añadió dependencia. El primer intento aislado terminó con exit 1 por `EPERM` de Corepack sobre `C:\Users\luism\AppData\Local\Corepack\lastKnownGood.json`; la repetición con acceso al toolchain terminó correctamente. |
| `pnpm -w typecheck` | 0 | PASS | TypeScript sin errores. Primer intento aislado afectado por el mismo `EPERM` de Corepack; repetición correcta. |
| `pnpm -w lint:ci` | 0 | PASS | ESLint con cero warnings/errores. Primer intento aislado afectado por el mismo `EPERM`; repetición correcta. |
| `pnpm -w gate:any-sensitive` | 0 | PASS | 44 entradas baseline, sin regresiones. El propio gate indica 7 entradas baseline ya obsoletas; deuda P2, no fallo del gate. |
| `pnpm -w test:pilot:coverage:ci` | 0 | PASS | Cobertura frontend: 72,68 % líneas (7.926/10.905) y 67,65 % ramas (1.673/2.473). Hubo warnings de `react-test-renderer`/`act`, sin fallo. |
| `pnpm -w test:e2e` | 0 | **PASS técnico / FAIL probatorio** | Playwright reportó 3/3 pruebas en 32,6 s, pero `tests/e2e/handover-flow.spec.ts` carga `STUB_HTML` y no la app real. |
| `pnpm -w validate:fhir` | 0 | PASS | 7 fixtures FHIR transaction validados, incluidos contextos hospitalario, UCI, urgencias, oncología y contextual. |
| `pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests` | 1 | FAIL de invocación local | `pytest` no estaba resoluble en el `PATH` de la shell aislada; no hubo colección ni fallo de módulo de HANDOVER. |
| Equivalente diagnóstico con Python 3.12 absoluto | 0 | PASS | 407 tests backend pasaron en 46,65 s. |
| `pnpm -w quality:release` | 0 | PASS | Gate compuesto completo, incluido pytest con cobertura. Cobertura backend: 87,83 % líneas (11.204/12.756) y 64,69 % ramas (2.048/3.166). |

### Lectura correcta de los gates

- El PASS de `quality:release` es real para los comandos que compone.
- No permite declarar READY porque incorpora como “E2E” una prueba autocontenida sobre stub.
- El fallo del comando `pytest` directo es de resolución del ejecutable en esta shell, no de la suite: la suite pasó tanto mediante Python absoluto como dentro de `quality:release`.
- La ejecución local usó Node `v22.14.0`; CI declara Node `20.17.0` mediante `.nvmrc`. Los gates pasan, pero la reproducción en el toolchain exacto de CI queda no verificada.

## Hallazgos P0

### P0-01 — Fallback silencioso a pacientes demo en rutas operativas

Clasificación: **OBSERVADO — P0**

Evidencia:

- `backend/api/views.py:1744-1801`: `PatientView` captura cualquier `httpx.HTTPError`, consulta `DemoPatient` y devuelve el Bundle demo con HTTP 200 si encuentra registros.
- `backend/api/views.py:1888-2075`: `PatientsView`, después de no encontrar pacientes locales, intenta FHIR; ante error de red devuelve `_build_demo_patient_bundle(...)` con HTTP 200.
- `backend/api/views.py:2025-2032`: el mismo fallback existe para consultas de múltiples unidades.
- `backend/api/views.py:2055`: el comentario confirma que el fallback existe para satisfacer `RoleAclTests`.
- `backend/api/tests/test_role_acl.py:287-313` y `backend/tests/test_patients_api.py:434-472`: las pruebas consolidan expresamente el comportamiento de devolver demo ante FHIR caído.
- `backend/api/fixtures/demo_patients.json`: contiene identidades sintéticas con nombres, fecha de nacimiento y unidad; los IDs llevan prefijo `demo-`, pero la respuesta no incluye una marca de degradación y conserva HTTP 200.
- No hay condición por `HANDOVER_DEPLOYMENT_MODE`, `DEBUG` o demo session alrededor de este fallback.

Impacto:

- Una indisponibilidad de FHIR puede presentarse como una lista clínica válida.
- El cliente no puede distinguir “FHIR caído” de “pacientes encontrados”.
- Aunque el dataset sea sintético y quede filtrado por unidad, la degradación es silenciosa y cruza la frontera entre demo y operación.

Recomendación quirúrgica, no implementada:

- En `pilot`/`production`, fallar explícitamente con 503 o un contrato de degradación inequívoco y nunca sustituir la fuente clínica por `DemoPatient`.
- Restringir datos demo a un modo de despliegue/demo explícito.
- Añadir tests de fail-closed para `pilot`/`production` y mantener tests demo separados.

### P0-02 — El gate E2E no prueba la aplicación real

Clasificación: **OBSERVADO — P0**

Evidencia:

- `tests/e2e/handover-flow.spec.ts:3-10` declara que usa una UI stub autocontenida en vez del bundle Expo.
- `tests/e2e/handover-flow.spec.ts:13-122` implementa el formulario, QR, audio, firma y finalización en HTML/JavaScript de prueba.
- `tests/e2e/handover-flow.spec.ts:124-131` ejecuta `page.setContent(STUB_HTML)` antes de cada test y no navega a `baseURL`.
- `playwright.config.ts:29` sí arranca Expo web, pero las pruebas no consumen esa app.
- `.github/workflows/ci.yml:113-120` publica el resultado como “End-to-end tests” y `playwright-evidence`.
- `.github/workflows/ci.yml:155` describe el alcance como “browser E2E”.
- `scripts/release-rehearsal.ps1:58` usa el mismo comando como evidencia de ensayo.

Impacto:

- No hay evidencia ejecutable actual de login real, PatientList real, navegación real, HandoverForm real, cola real o cierre real en Expo/web/Android.
- Un fallo de import, render, navegación, configuración demo o interacción de la app puede coexistir con un PASS 3/3.

Recomendación quirúrgica, no implementada:

- Conservar el stub solo si se renombra y reclasifica como smoke del contrato de `testID`.
- Crear/restaurar un spec bloqueante que navegue a la app real y cubra el camino sintético mínimo de salud mental.
- No aceptar `playwright-evidence` como evidencia E2E clínica hasta que el artefacto muestre interacción con la app real.

## Hallazgos P1

| ID | Clasificación | Hallazgo | Evidencia / cierre requerido |
|---|---|---|---|
| P1-01 | **NO VERIFICADO — P1** | Demo sintética de salud mental en artefacto preview/Android | `isDemoAccessEnabled()` solo habilita demo por `__DEV__` o `EXPO_PUBLIC_ENABLE_DEMO`; `eas.json` no fija esa variable. Puede existir en el entorno remoto EAS, pero no hay evidencia en repo ni build ejecutada. Adjuntar configuración no secreta y smoke del binario candidato. |
| P1-02 | **NO VERIFICADO — P1** | Build EAS/Android candidato | `app.config.ts` y `eas.json` son resolubles y conservan package/versionCode, pero no se ejecutó `eas build`, instalación en dispositivo ni smoke de permisos cámara/audio/notificaciones. |
| P1-03 | **NO VERIFICADO — P1** | Estado CI remoto del HEAD | Los workflows están presentes y los gates locales pasan, pero no se consultó ni adjuntó una ejecución GitHub Actions del commit exacto. Además, el significado del artefacto Playwright debe corregirse por P0-02. |
| P1-04 | **NO VERIFICADO — P1** | Backup/restore institucional | `.github/workflows/backup.yml` ejecuta backup nocturno cifrado y el runbook es scratch-first; no se ejecutó un restore drill ni se verificaron secretos, remoto, retención o integridad de un artefacto real. |
| P1-05 | **NO VERIFICADO — P1** | Release rehearsal completo | Se ejecutaron los gates, pero no los stages completos de `scripts/release-rehearsal.ps1`: `docker compose config`, perf smoke, backup/restore, package y postdeploy no quedaron evidenciados. |
| P1-06 | **OBSERVADO — P1** | No existe tag candidato para este HEAD | El único tag es `v0.2.0-rc.0`; el registro maestro y README ya reconocen correctamente que `1.0.0` es metadata y que `v0.4.0-rc.1` no es un release verificable. Crear tag solo tras cerrar P0 y aprobar Go/No-Go. |
| P1-07 | **NO VERIFICADO — P1** | Reproducción en toolchain CI | La ejecución local usó Node 22.14.0, mientras `.nvmrc`/CI fijan 20.17.0. Repetir el gate final en el toolchain exacto y adjuntar salida. |

## Hallazgos P2

| ID | Clasificación | Hallazgo | Evidencia / recomendación |
|---|---|---|---|
| P2-01 | **OBSERVADO — P2** | Endpoint incorrecto en walkthrough demo | `docs/MVP_DEMO.md:78` usa `http://localhost:8000/ai/summarize-sbar`; `backend/urls.py:13` monta las rutas de `backend/api/urls.py` bajo `/api/`, por lo que la URL real es `/api/ai/summarize-sbar`. Corregir solo documentación. |
| P2-02 | **OBSERVADO — P2** | README describe un mecanismo demo obsoleto | `README.md:97` indica ajustar flags en `app.config.ts` y usar `LoginMock.tsx`; el gate real está en `src/security/demo-access.ts` con `EXPO_PUBLIC_ENABLE_DEMO` y la UI activa es `LoginScreen.tsx`. Alinear el texto sin cambiar auth. |
| P2-03 | **OBSERVADO — P2** | Baseline `any` contiene entradas obsoletas | `gate:any-sensitive` pasa con 44 entradas y reporta 7 que ya podrían eliminarse. No afecta este prepiloto; limpiar en una intervención separada y focalizada. |
| P2-04 | **OBSERVADO — P2** | Warnings de test React | La suite frontend pasa, pero emite warnings de `react-test-renderer` deprecado y actualizaciones fuera de `act(...)`. No son fallo funcional observado. |
| P2-05 | **OBSERVADO — P2** | Invocación directa de pytest no reproducible en esta shell | El ejecutable no estaba en `PATH`; Python absoluto y `quality:release` pasan 407 tests. Documentar/activar el entorno Python correcto en el runbook local. |

## Áreas revisadas

| Área | Estado actual | Clasificación |
|---|---|---|
| 1. Arranque local | El webServer de Playwright llegó a estado ready, pero la app real no fue renderizada por los tests. Backend importa y ejecuta la suite completa. | **NO VERIFICADO — P0**, absorbido por P0-02 |
| 2. Demo sintética de salud mental | Fixtures frontend con MRN `MRN-DEMO-*`, perfiles de salud mental para variantes adulta, infantojuvenil y de psicogeriatría, y guion psiquiátrico presentes. En el estado auditado existían identificadores demo específicos/institucionales que requieren neutralización. Artefacto preview no verificado. | **OBSERVADO — NO-ACTION** para dataset; **NO VERIFICADO — P1** para binario |
| 3. Navegación | `RootNavigator` mantiene guards de capacidad y rutas a Handover/SyncCenter; tests unitarios pasan. No existe E2E real. | **OBSERVADO — NO-ACTION** en código; P0-02 en evidencia |
| 4. Auth/demo mode | OIDC/JWT/RBAC conservados; demo está gated y muestra banner. Falta evidencia del flag en preview. | **OBSERVADO — NO-ACTION** en contrato; P1-01 |
| 5. HandoverForm | Un único formulario usa Zod, runtime de perfil, construcción FHIR, validación y cola canónica; firma/checklist preceden finalización. | **OBSERVADO — NO-ACTION** |
| 6. FHIR | Pipeline UI → Zod → mapper → queue/sync → cliente/backend FHIR conservado; 7 fixtures pasan; backend exige JWT, roles, scopes, unidad y firma. | **OBSERVADO — NO-ACTION**, salvo P0-01 en lectura de pacientes |
| 7. Offline/sync | SQLite canónico, cifrado fail-closed en producción, idempotencia, retry/backoff y tratamiento explícito de 401/403/409/412/422. | **OBSERVADO — NO-ACTION** |
| 8. Backend | Django/DRF sigue siendo backend único; 407 tests pasan y cobertura de líneas es 87,83 %. | **OBSERVADO — NO-ACTION**, salvo P0-01 |
| 9. ICEA shadow | Bridge post-FHIR no bloqueante, payload con governance no individual, redacción de score en respuestas no-scoring, roles y tests específicos. | **OBSERVADO — NO-ACTION** |
| 10. CI | Workflows y gates existen; resultado local compuesto PASS. El gate E2E está mal representado y el run remoto no fue consultado. | P0-02 y P1-03 |
| 11. Backups | Backup cifrado fail-closed y restore scratch-first documentados; ejecución real no verificada. | **NO VERIFICADO — P1** |
| 12. EAS/Android | Configuración Expo/EAS presente; `com.handover.app`, `versionCode: 1`, permisos y perfiles internal/production definidos. No hay binario candidato verificado. | **NO VERIFICADO — P1** |
| 13. Datos sintéticos/PHI | No se observó PHI real en fixtures inspeccionados; frontend y bundles demo se identifican como sintéticos. El fallback backend mezcla esos datos con ruta clínica. | **OBSERVADO — NO-ACTION** para PHI; P0-01 |
| 14. Versionado/tag | Documentación reconoce honestamente la deriva; falta tag del candidato actual. | **OBSERVADO — P1** |
| 15. Runbook de demo | Guiones genérico y de salud mental existen; endpoint AI incorrecto y no especifican evidencia del flag demo para preview. | P2-01 y P1-01 |
| 16. Release rehearsal | Script y criterios de aborto/rollback existen; ejecución completa no evidenciada y su paso E2E hereda P0-02. | P0-02 y P1-05 |

## Contradicciones documentación ↔ código

1. **E2E real vs stub**: CI y README presentan `test:e2e`/`playwright-evidence` como browser E2E, pero el spec declara y usa HTML stub.
2. **URL AI demo**: `docs/MVP_DEMO.md` omite el prefijo `/api` exigido por `backend/urls.py`.
3. **Activación demo**: README remite a `LoginMock.tsx` y flags de `app.config.ts`; el código vigente usa `LoginScreen.tsx` y `EXPO_PUBLIC_ENABLE_DEMO`.
4. **Sin contradicción de release**: README, registro maestro y release notes ya expresan correctamente que solo `v0.2.0-rc.0` es verificable. No se reabre ese trabajo histórico; el pendiente actual es generar un tag nuevo únicamente cuando exista un candidato aprobado.
5. **Sin contradicción arquitectónica observada**: no se encontró FastAPI, microservicio paralelo, formulario por unidad ni acceso móvil directo a ICEA.

## Contratos verificados que no deben tocarse en esta intervención

- Schemas Zod y `src/validation/*`.
- Mapper, validación, cliente y contrato FHIR.
- Cola SQLite, cifrado, idempotencia, retry y sync.
- OIDC/JWT/RBAC, scopes, unidad y auditoría.
- Runtime Core + UPP + SOP + MPAC y overlays de perfiles.
- HandoverForm único y sus secciones clínicas.
- MPAC.
- Outbox, bridge y contratos ICEA shadow/agregados.
- Contratos HTTP existentes, salvo un cambio posterior específicamente aprobado para eliminar el fallback inseguro de P0-01 con compatibilidad y tests.

## Secuencia recomendada de cierre

1. Abrir un cambio independiente y mínimo para P0-01: fail-closed de pacientes en `pilot`/`production`, demo explícito y tests por modo.
2. Abrir otro cambio independiente para P0-02: separar el smoke stub de un E2E real bloqueante.
3. Ejecutar el walkthrough sintético de salud mental contra el artefacto exacto de preview/Android, con evidencia de demo flag, navegación, HandoverForm, offline/replay y cierre FHIR.
4. Repetir `quality:release` con Node 20.17.0 y adjuntar ejecución CI del HEAD resultante.
5. Ejecutar rehearsal completo y backup/restore scratch-first.
6. Solo entonces decidir Go/No-Go institucional y crear el tag RC real.

## Comandos ejecutados

### Estado Git

```powershell
git status --short
git rev-parse HEAD
git log --oneline -20
git tag --list
git branch --show-current
git rev-parse main
git rev-parse origin/main
git diff --name-only main...HEAD
git diff --check
```

### Gates solicitados

```powershell
pnpm install --frozen-lockfile
pnpm -w typecheck
pnpm -w lint:ci
pnpm -w gate:any-sensitive
pnpm -w test:pilot:coverage:ci
pnpm -w test:e2e
pnpm -w validate:fhir
pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests
pnpm -w quality:release
```

Los cuatro primeros comandos pnpm se repitieron después del `EPERM` inicial de Corepack en la shell aislada. Los siguientes gates pnpm se ejecutaron con acceso al toolchain desde el inicio.

### Diagnóstico equivalente de pytest

```powershell
& 'C:\Users\luism\AppData\Local\Programs\Python\Python312\python.exe' -m pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests
```

### Inspección

Se usaron lecturas no mutantes con `Get-Content -LiteralPath` y búsquedas `rg -n`/`rg --files` sobre los archivos mínimos solicitados, `AGENTS.md`, `docs/clinical-profiles-framework.md`, `code_review.md`, tests relacionados, configuración de navegación/demo, backend FHIR y contratos ICEA. También se leyeron los XML de cobertura generados por los gates.

## Alcance negativo y estado final

- No se implementaron features.
- No se refactorizó runtime.
- No se cambió FHIR, Zod, auth/RBAC, queue/sync, perfiles, MPAC ni ICEA.
- No se añadió ni actualizó dependencia.
- No se corrigió automáticamente ningún hallazgo.
- No se creó commit.
- El único cambio versionable de esta auditoría es este documento.
