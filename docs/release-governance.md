# C16 / S19: gate técnico de merge

`ci.yml` conserva `pull_request`, `push` a `main` y `workflow_dispatch`. Su job `build` ejecuta los controles frontend, E2E y validación FHIR. El job `backend` llama a `django.yml` desde el mismo commit; ese workflow conserva `workflow_dispatch` para recuperación manual y ya no inicia otra corrida automática por el mismo push o PR.

En Django, la matriz fija 3.10/3.11/3.12 y `coverage` conservan sus comandos. `backend-gate` usa `always()` y falla salvo que la matriz y coverage terminen ambos en `success`. El job estable `release-gate` espera `build` y `backend`, también con `always()`: solo aprueba cuando ambos jobs y los resultados exportados de matriz y coverage son exactamente `success`. Un resultado ausente, `skipped`, `cancelled` o `failure` no aprueba.

El artefacto `release-gate-evidence` y el resumen de la corrida registran el SHA probado y los resultados observados. En un PR, `GITHUB_SHA` identifica el commit de fusión de prueba; se registra aparte `github.event.pull_request.head.sha` como HEAD de la rama. El check no atribuye el resultado del merge de prueba al HEAD de la rama.

## Propuesta externa pendiente

El ruleset activo `main` (ID `12605796`) se aplica a la rama por defecto y contiene `deletion`, `non_fast_forward` y `pull_request` con resolución obligatoria de conversaciones. Al inspeccionarlo no había regla `required_status_checks`; la protección clásica de rama devolvió 404. No se ha modificado la configuración de GitHub.

Tras verificar en el PR el nombre y emisor reales del check agregado, añadir al mismo ruleset, preservando condiciones, bypasses y reglas actuales:

```json
{
  "type": "required_status_checks",
  "parameters": {
    "strict_required_status_checks_policy": true,
    "required_status_checks": [
      {"context": "release-gate", "integration_id": 15368}
    ]
  }
}
```

`integration_id: 15368` corresponde a GitHub Actions en los check-runs observados de `main`; el contexto `release-gate` debe confirmarse en el PR antes de aplicar la propuesta. `RULESET_EXTERNAL=NOT_VERIFIED`: el job por sí solo no obliga a esperar ese check para fusionar. No se alteró `CODEOWNERS`, código clínico, secretos ni despliegues. C15 permanece PARTIAL por avisos de audit sin exposición determinada y por CycloneDX/SPDX `NOT_IMPLEMENTED`; `test:unit` sigue NO VERDE por sus tres fallos baseline conocidos.
