# C15 / S18: inventario y límites de cadena de suministro

Fecha de comprobación: 2026-11-09 UTC. Parent auditado: `cabb27dd3a3f94ed4b38d76b1f7cdf0ec98db01e`.
El cambio fija las referencias `uses:` directas sin cambiar las versiones mayores, jobs, permisos, disparadores ni runners. `backup.yml` también configura `persist-credentials: false` en checkout; no se ejecutaron backups ni staging.

## Correspondencia verificada de Actions

Se consultó `git ls-remote --tags https://github.com/<owner>/<repo>.git refs/tags/<tag> refs/tags/<tag>^{}` en cada repositorio original. El valor fijado es el commit del tag, no un hash abreviado. En `pnpm/action-setup`, `v2` es una rama: su HEAD coincidía con el commit al que se resuelve el tag anotado `v2.4.1`. Esta observación no impide que esas referencias cambien en el futuro; el workflow usa el SHA fijo.

| Action | Referencia previa | SHA completo fijado y verificación |
| --- | --- | --- |
| [appleboy/ssh-action](https://github.com/appleboy/ssh-action/tree/v0.1.5) | `v0.1.5` | `f9010ff7f1bbd7db1a0b4bab661437550cea20c0` = tag `v0.1.5` |
| [actions/checkout](https://github.com/actions/checkout/tree/v4) | `v4` | `11d5960a326750d5838078e36cf38b85af677262` = tag `v4` |
| [actions/setup-python](https://github.com/actions/setup-python/tree/v5) | `v5` | `a26af69be951a213d495a4c3e4e4022e16d87065` = tag `v5` |
| [actions/setup-node](https://github.com/actions/setup-node/tree/v4) | `v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` = tag `v4` |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/tree/v4) | `v4` | `ea165f8d65b6e75b540449e92b4886f43607fa02` = tag `v4` |
| [pnpm/action-setup](https://github.com/pnpm/action-setup/tree/v2.4.1) | rama `v2` | `eae0cfeb286e66ffb5155f1a79b90583a127a68b` = `v2` y `v2.4.1^{}` |

## Audit del parent

`pnpm audit --json` devolvió código `1` el 2026-11-09 15:19:28 UTC. `metadata.vulnerabilities`: 9 critical, 129 high, 74 moderate, 21 low. Son 126 avisos únicos high/critical (9 critical, 117 high); un aviso puede afectar varias versiones y contabilizar más de una incidencia. [La matriz por aviso](supply-chain-audit-2026-11-09.csv) conserva ID, paquete, raíces de dependencia, ámbito y estado de exposición para **cada** aviso high/critical.

La matriz asigna el ámbito desde la ruta del audit y los manifiestos: 85 avisos en herramientas de build, 17 en CI, 14 bajo dependencias declaradas de runtime y 10 con rutas tanto de build como de runtime. `runtime-manifest` significa presencia en `dependencies`, no ejecución demostrada en el paquete entregado. Todos figuran como `indeterminate`: el audit prueba versiones vulnerables instalables, pero no acredita que el llamador vulnerable sea alcanzable en la app, CI o staging. Tampoco acredita descarte seguro. Entre los critical están `shell-quote` vía React Native, `proxy-addr` vía Express, `tar` vía Expo CLI y `handlebars`/`vitest`/`tinypool` en pruebas. No se aplicó `audit fix --force`, no se retiró ninguna dependencia y el análisis de desuso/retirada queda para C19B.

## Inventario SOUP reproducible

`python scripts/generate-soup-inventory.py > soup-inventory.json` usa únicamente la biblioteca estándar y lee `package.json`, `pnpm-lock.yaml`, `requirements.txt`, `requirements-dev.txt` y `backend/requirements.txt`. Ordena las entradas y omite timestamps y rutas absolutas. Dos ejecuciones sobre el mismo árbol produjeron el mismo SHA-256: `A7EF3F8F33BA44517663E7B099707DDCA003E6997F179468FD8E15A6A063FF8D` (77 dependencias JS directas, 1350 entradas de paquetes del lockfile y 21 requisitos Python). El JSON generado no se añade al repositorio.

`CycloneDX/SPDX = NOT_IMPLEMENTED`. El inventario no resuelve rangos Python, licencias, componentes realmente empaquetados ni el árbol de descargas externo. No se elige una licencia ni se declara cumplimiento IEC 62304.

## Riesgos restantes

Fijar `uses:` protege la referencia directa. Aún pueden variar las descargas que efectúan Actions y jobs: binarios de Node/Python/pnpm/Playwright, instalaciones `pip` (incluido `pip --upgrade` y `genbadge`), paquetes `apt`, `docker compose pull` de staging y dependencias transitivas. `pnpm install --frozen-lockfile` conserva versiones e integridad declaradas, pero no convierte este cambio en una verificación integral del origen. Los runners `ubuntu-latest` existentes siguen móviles. Staging y Nightly Backups no se activaron ni verificaron; el secreto `RCLONE_CONFIG_BASE64` continúa pendiente.
