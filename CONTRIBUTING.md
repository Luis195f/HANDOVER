# Contributing

## Antes de cambiar código

- Lee `AGENTS.md`.
- Si el cambio toca comportamiento clínico o perfiles, lee también `docs/clinical-profiles-framework.md`.
- Trabaja siempre sobre el estado real del repo y evita cambios arquitectónicos amplios.

## Reglas del repo

- Backend operativo único: Django/DRF.
- No introduzcas FastAPI, microservicios ni backends paralelos.
- No dupliques formularios clínicos por unidad; usa perfiles, configuración u overlays existentes.
- No introduzcas secretos en el cliente ni en variables `EXPO_PUBLIC_*`.

## Validación mínima esperada

Ejecuta lo proporcional al seam tocado. Para cambios de higiene, docs o gobernanza con impacto transversal, la base mínima del repo es:

```bash
pnpm -w typecheck
pnpm -w lint:ci
```

Si tocas contratos, validación, FHIR, auth, sync, backend o perfiles, amplía con:

```bash
pnpm test
pnpm -w validate:fhir
pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests
```

## Pull requests

- Mantén el cambio quirúrgico y justificado.
- Documenta comandos ejecutados y resultado real.
- Declara riesgos residuales y lo que decidiste no tocar.
- No vendas estado “production-ready” o claims regulatorios sin evidencia.
