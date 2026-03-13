# docs/AGENTS.md

## Alcance

Estas reglas aplican a toda documentación del proyecto.

## Principio

La documentación debe reflejar el estado real del repositorio, no el deseado.

## Qué debe actualizarse

Actualiza documentación cuando cambie cualquiera de estos elementos:
- arquitectura
- pipeline clínico
- runtime de perfiles
- contrato HTTP
- contrato FHIR
- políticas de sync/queue/retry
- seguridad, auth, auditoría o PHI
- comportamiento de bridge o scoring si aplica

## Qué evitar

- No escribas documentación aspiracional como si ya estuviera implementada.
- No describas comportamientos que el código no soporta.
- No ocultes limitaciones reales.
- No uses lenguaje regulatorio excesivo sin base técnica en el código y el proceso real.

## Cómo documentar

Cuando haya cambios relevantes, documenta:
- qué cambió
- por qué cambió
- qué no cambió
- qué riesgo residual queda
- qué pruebas respaldan el cambio

## Calidad de la documentación

La documentación debe ser:
- concreta
- verificable
- alineada con el código
- útil para desarrollo, auditoría y revisión técnica

## Definición de cierre en docs

No cierres una tarea documental si:
- repite generalidades sin aterrizar al repo
- contradice el comportamiento real
- omite limitaciones importantes
- no deja claro el impacto del cambio
