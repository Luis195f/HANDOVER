# AGENTS.md

## Misión del repositorio

HANDOVER es un sistema digital de entrega de turno de enfermería orientado a interoperabilidad clínica, trazabilidad, seguridad y operación offline-first. Trabaja siempre sobre el estado actual real del repositorio.

## Regla principal

No reinventes la arquitectura.

## Invariantes obligatorios

- Mantener la arquitectura actual del proyecto.
- Mantener el enfoque frontend React Native / Expo + TypeScript.
- Mantener el backend y puentes existentes sin crear arquitecturas paralelas.
- Mantener el pipeline clínico actual:
  UI/Pantallas -> validación Zod -> mapeo FHIR -> queue/sync -> fhir-client -> servidor FHIR/HCE.
- Mantener el enfoque offline-first.
- Mantener la lógica de perfiles clínicos sobre un núcleo compartido, evitando duplicación innecesaria de formularios.
- Mantener compatibilidad razonable con contratos existentes salvo necesidad justificada.

## Prohibiciones

- No crear microservicios nuevos.
- No introducir un backend paralelo.
- No introducir frameworks no autorizados para “resolver más rápido”.
- No dejar TODO vacíos como cierre de trabajo.
- No reemplazar lógica real por mocks cuando el cambio pide comportamiento real.
- No romper contratos FHIR, contratos HTTP, runtime clínico o sincronización sin pruebas y documentación.
- No introducir nuevas dependencias de producción sin justificación fuerte.
- No usar `any`, `@ts-ignore`, `@ts-nocheck` o casts forzados nuevos salvo imposibilidad técnica muy justificada y acotada.

## Zonas de alto riesgo

Trata estos módulos como sensibles y de alto impacto:

- `src/lib/fhir-map*`
- `src/lib/fhir-validation*`
- `src/lib/fhir-client*`
- `src/lib/sync*`
- `src/lib/queue*`
- `src/validation/*`
- `src/security/*`
- `src/config/profiles/*`
- `src/config/*units*`
- `src/lib/profile-runtime*`
- `src/screens/HandoverForm*`
- `backend/api/*`
- `backend/*` relacionado con bridge, colas, auth o contratos

## Reglas de cambio

### 1. Cambios pequeños y auditables
- Prefiere cambios pequeños, idempotentes y reversibles.
- Si el cambio es grande, divídelo por capas o por dominio.
- Si el objetivo es ambiguo, planifica antes de codificar.

### 2. Pruebas obligatorias
Todo cambio en módulos sensibles exige pruebas o ajuste explícito de pruebas existentes.

Como mínimo:
- typecheck
- lint
- tests relevantes
- validación FHIR si aplica

### 3. Documentación obligatoria
Actualiza documentación cuando cambie cualquiera de estos puntos:
- comportamiento clínico
- contrato HTTP
- contrato FHIR
- política de sincronización
- runtime de perfiles
- seguridad, PHI, autenticación o auditoría

### 4. Seguridad y PHI
- Nunca expongas PHI en logs, errores o mensajes de depuración.
- No introduzcas fallbacks inseguros silenciosos.
- Si detectas un compromiso entre seguridad y compatibilidad, hazlo explícito y documentado.

### 5. Interoperabilidad
- Reutiliza diccionarios de terminología y helpers centralizados.
- Evita hardcodes de códigos clínicos cuando exista una fuente central o deba existir.
- Si refactorizas FHIR, conserva el contrato público o deja compatibilidad hacia atrás claramente documentada.

## Qué significa “hecho”

Un cambio solo está realmente hecho cuando:
- resuelve el objetivo pedido
- respeta la arquitectura
- no abre una arquitectura paralela
- incluye pruebas o justifica con honestidad por qué no pudo añadirlas
- no introduce deuda evitable
- deja documentación mínima actualizada si cambió comportamiento relevante

## Qué hacer ante dudas

Si hay más de una forma de implementar algo:
- elige la más conservadora
- favorece compatibilidad
- favorece claridad y mantenibilidad
- evita expansión de alcance

## Regla de PR

Antes de considerar algo apto para PR:
- revisa `code_review.md`
- verifica contratos sensibles
- enumera riesgos residuales
- declara de forma explícita qué no fue tocado
