# AGENTS.md

## Misión del repositorio

HANDOVER es un sistema digital de entrega de turno de enfermería orientado a interoperabilidad clínica, trazabilidad, seguridad y operación offline-first. Trabaja siempre sobre el estado real actual del repositorio.

## Regla principal

No reinventes la arquitectura.

## Fuente vinculante

- `AGENTS.md` define cómo trabajar.
- `docs/clinical-profiles-framework.md` define la arquitectura clínico-funcional que no debe romperse.

## Arquitectura operativa vigente

- Frontend: React Native / Expo + TypeScript.
- Backend: Django + DRF.
- Interoperabilidad: FHIR transaction + lectura ETL + outbox ICEA.
- Seguridad: OIDC / JWT / RBAC / auditoría.
- Marco de producto: Core + UPP + SOP + MPAC + ICEA+.
- Pipeline obligatorio: UI/Pantallas -> validación Zod -> mapeo FHIR -> queue/sync -> fhir-client -> servidor FHIR/HCE.

## Invariantes obligatorios

- Mantener la arquitectura actual del proyecto.
- Mantener el enfoque offline-first.
- Mantener la lógica de perfiles clínicos sobre un núcleo compartido.
- No crear formularios paralelos por unidad o especialidad.
- Mantener compatibilidad razonable con contratos existentes salvo necesidad justificada.
- Preservar el trust boundary FHIR y los contratos runtime existentes salvo necesidad demostrada.

## Prohibiciones

- No crear microservicios nuevos.
- No introducir un backend paralelo.
- No introducir FastAPI nuevo dentro de HANDOVER.
- No introducir frameworks no autorizados para "resolver más rápido".
- No reemplazar lógica real por mocks cuando el cambio pide comportamiento real.
- No romper contratos FHIR, contratos HTTP, runtime clínico o sincronización sin pruebas y documentación.
- No introducir nuevas dependencias de producción sin justificación fuerte.
- No usar `any`, `@ts-ignore`, `@ts-nocheck` o casts forzados nuevos salvo imposibilidad técnica muy justificada y acotada.
- No dejar TODOs vacios como cierre de trabajo.

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

### 1. Cirugía mínima
- Prefiere cambios pequeños, auditables, idempotentes y reversibles.
- Si el objetivo es ambiguo, primero diagnostica y luego propone.
- Si hay más de una forma de hacerlo, elige la más conservadora.
- No expandas alcance para "aprovechar" la intervención.

### 2. Pruebas proporcionales
- Todo cambio en módulos sensibles exige pruebas o ajuste explícito de pruebas existentes.
- Ejecuta solo la validación necesaria para el seam tocado, pero no omitas lo crítico.
- Como mínimo cuando aplique: typecheck, lint, tests relevantes y validación FHIR.

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

### 5. Interoperabilidad y perfiles
- Reutiliza diccionarios de terminología y helpers centralizados.
- Evita hardcodes de códigos clínicos cuando exista una fuente central o deba existir.
- No dupliques el Core para resolver variaciones de unidad; usa configuración, UPP o SOP cuando ya exista esa costura.
- Si refactorizas FHIR o runtime de perfiles, conserva el contrato público o deja compatibilidad hacia atrás claramente documentada.

## Qué significa "hecho"

Un cambio solo está realmente hecho cuando:
- resuelve el objetivo pedido
- respeta la arquitectura
- no abre una arquitectura paralela
- incluye pruebas o justifica con honestidad por qué no pudo añadirlas
- no introduce deuda evitable
- deja documentación mínima actualizada si cambió comportamiento relevante

## Qué hacer ante dudas

Si no puedes identificar una única estrategia de bajo riesgo:
- deten la implementación
- explica la ambigüedad real
- propone el siguiente paso mínimo verificable

## Regla de PR

Antes de considerar algo apto para PR:
- revisa `code_review.md`
- verifica contratos sensibles
- enumera riesgos residuales
- declara de forma explícita que no fue tocado
