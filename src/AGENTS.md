# src/AGENTS.md

## Alcance

Estas reglas aplican a todo el frontend y lógica cliente de HANDOVER en `src/`.

## Stack obligatorio

- React Native / Expo
- TypeScript
- Validación con Zod cuando corresponda
- Integración con la arquitectura actual del repositorio

## Reglas generales

- No añadas librerías nuevas sin una justificación fuerte.
- Prefiere utilidades puras y tipadas.
- Evita mezclar UI con lógica clínica compleja cuando puedas extraer helpers.
- No metas lógica clínica sensible directamente en componentes visuales si puede vivir en `lib/`, `validation/` o `config/`.

## HandoverForm y pantallas complejas

`src/screens/HandoverForm.tsx` y pantallas relacionadas son zonas de alta sensibilidad.

Cuando las toques:
- evita crecer aún más el componente si puedes extraer lógica sin romper contratos
- mantén compatibilidad con valores de formulario existentes
- no cambies nombres de campos ni shape de datos sin revisar mapeo FHIR, validación y tests
- no introduzcas reglas clínicas nuevas sin validación y documentación

## Validación

Para cambios en `src/validation/*`:
- mantén coherencia entre schema, UI y mapper
- añade validaciones clínicas razonables cuando correspondan
- no uses validaciones arbitrarias sin sustento funcional
- si cambias un rango o requisito, revisa el impacto en tests y FHIR

## FHIR mapping

Para cambios en `src/lib/fhir-map*`:
- preserva el contrato público tanto como sea posible
- separa por dominios si refactorizas, sin cambiar semántica clínica
- usa constantes, helpers y diccionarios centralizados
- no hardcodees códigos si existe o debe existir una fuente central
- no uses `console.*` para señalizar decisiones clínicas o errores silenciosos en producción

## FHIR validation

Para cambios en `src/lib/fhir-validation*`:
- prioriza validación útil para CI, tests y desarrollo
- no bloquees UX clínica por validaciones pesadas sin necesidad
- devuelve errores claros, consistentes y auditables

## Sync y queue

Para cambios en `src/lib/sync*`, `src/lib/queue*` o networking relacionado:
- conserva el enfoque offline-first
- diferencia errores reintentables y no reintentables
- evita duplicados, loops o reencolados ambiguos
- no expongas PHI en logs
- no introduzcas persistencia sensible insegura sin delimitarla claramente

## Seguridad

Para cambios en `src/security/*`:
- no debilites auth, session, firma ni almacenamiento seguro
- no añadas bypasses silenciosos
- si hay fallback solo para dev/web, déjalo explícito y aislado

## Perfiles y runtime

Para cambios en:
- `src/config/profiles/*`
- `src/config/units*`
- `src/lib/profile-runtime*`

debes:
- mantener un núcleo compartido
- evitar duplicar formularios por unidad
- hacer explícita la precedence entre core, unit packs y overlays
- cubrir con tests las reglas de visibility, flags y compatibilidad

## Tipado

- No añadas `any` nuevos salvo necesidad extrema.
- Prefiere type guards, uniones discriminadas y helpers tipados.
- Si heredas una zona con deuda de tipos, mejora lo que toques sin expandir el alcance innecesariamente.

## Pruebas mínimas esperadas

Si tocas frontend/lógica cliente sensible, corre o deja lista la verificación de:
- `pnpm -w typecheck`
- `pnpm -w lint`
- `pnpm -w test`

Si cambias FHIR o contratos clínicos, añade además:
- validación FHIR o pruebas equivalentes del bundle generado

## Definición de cierre en `src/`

No cierres un cambio como “listo” si:
- rompe schemas
- rompe mapper
- rompe sync
- rompe runtime de perfiles
- cambia shape de datos sin tests
- agrega deuda de tipos evitable
