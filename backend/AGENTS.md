# backend/AGENTS.md

## Alcance

Estas reglas aplican al backend existente de HANDOVER.

## Regla principal

Mantén el backend actual y sus contratos. No crees un backend paralelo.

## Prohibiciones

- No introduzcas un nuevo framework o servicio paralelo “temporal”.
- No dupliques endpoints existentes con otra semántica.
- No cambies contratos HTTP sin pruebas y documentación.
- No metas side effects opacos en views o services.

## Contratos HTTP

Cuando toques endpoints:
- conserva nombres, payloads y códigos de error cuando sea razonable
- si el cambio requiere romper compatibilidad, documenta el impacto y añade pruebas
- usa respuestas consistentes y auditables
- cuando aplique, devuelve errores estructurados y útiles

## OperationOutcome y errores

Si el backend participa en validación clínica o FHIR:
- favorece respuestas uniformes
- evita strings ad hoc para cada error
- no mezcles errores técnicos con mensajes clínicos ambiguos

## Auth, permisos y auditoría

Si tocas auth, permisos, tokens, firma o trazabilidad:
- no debilites autenticación ni control de acceso
- no expongas datos sensibles en logs
- no añadas bypasses ocultos
- mantén trazabilidad suficiente para auditoría

## Bridge, scheduler, outbox y colas

Si existen módulos de bridge, scheduler u outbox:
- evita doble scheduling
- evita retriggers opacos
- centraliza la fuente de verdad de encolado/reintento
- no cambies side effects sin pruebas de integración o unitarias

## Django / DRF / servicios

- Reutiliza servicios existentes antes de crear nuevas capas.
- Si extraes lógica desde views, hazlo hacia servicios claros y testeables.
- No mezcles reglas de negocio complejas directamente en endpoints si puedes aislarlas.

## Tests mínimos

Si tocas contratos backend o bridge:
- añade o ajusta tests
- cubre errores, reintentos y casos de contrato
- documenta claramente qué contratos siguen iguales

## Documentación obligatoria

Actualiza docs si cambias:
- endpoints
- payloads
- errores
- política de retry/scheduler
- bridge con ICEA+
- auth o auditoría

## Definición de cierre en backend

No cierres un cambio si:
- deja contratos implícitos
- rompe pruebas de API
- crea una ruta paralela innecesaria
- duplica scheduling
- introduce deuda de seguridad o trazabilidad
