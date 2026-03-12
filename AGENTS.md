# AGENTS.md - HANDOVER / ICEA+

## Proposito de este archivo
Este archivo define las reglas operativas persistentes para cualquier agente de codigo que trabaje sobre el repositorio **HANDOVER**.

Su objetivo es evitar regresiones arquitectonicas, contener deuda tecnica y guiar toda evolucion clinica/funcional hacia un modelo consistente con:

- **HANDOVER Core**
- **Unit Profile Packs (UPP)**
- **Specialty Overlay Packs (SOP)**
- **MPAC** = motor de priorizacion y anticipacion contextual
- **ICEA+ Layer** = analitica y atribucion ajustada por case-mix

`docs/clinical-profiles-framework.md` define el system of record clinico-arquitectonico. Este archivo define como debe trabajar el agente para implementarlo sin romper el estado real del repo.

---

# 1) CIRUGIA GUARDRAIL OBLIGATORIA ANTES DE CADA CAMBIO

Antes de implementar cualquier cambio, asumir explicitamente esta base de trabajo:

## 1.1. Trabajar sobre el estado real actual del repo
- No reinventar la arquitectura.
- No proponer una plataforma nueva paralela.
- No reescribir desde cero componentes que ya existen y pueden extenderse.

## 1.2. Mantener estrictamente la arquitectura actual
- **Frontend:** React Native / Expo + TypeScript
- **Backend:** Django + DRF
- **Interoperabilidad:** FHIR transaction + lectura ETL + outbox ICEA ya existentes
- **Seguridad:** OIDC / JWT / RBAC / auditoria ya existentes

## 1.3. Prohibiciones duras
- No introducir FastAPI nuevo dentro de HANDOVER
- No introducir microservicios nuevos
- No romper compatibilidad existente salvo necesidad critica justificada
- No crear formularios paralelos por unidad
- No duplicar logica clinica si puede resolverse con perfiles/configuracion
- No dejar TODOs vacios
- No dejar mocks cuando el objetivo exige backend real
- No dejar ramas de logica muertas o flags sin cablear
- No exponer secretos en cliente
- No debilitar la frontera de confianza FHIR
- No abrir rutas debug sin autenticacion
- No relajar permisos DRF estandar
- No filtrar PHI/PII en logs, errores o respuestas

## 1.4. Reglas de implementacion
- Hacer cambios **quirurgicos, idempotentes y aditivos**
- Reusar tipos, utilidades, contratos y componentes existentes
- Favorecer configuracion y composicion sobre hardcode
- Mantener coherencia entre frontend, backend, tests y docs
- Toda nueva capacidad debe quedar conectada de punta a punta o no introducirse

---

# 2) MISION DEL REPO

HANDOVER es un sistema clinico digital para **entrega de turno de enfermeria** con:
- captura estructurada
- continuidad asistencial
- interoperabilidad FHIR
- uso offline-first
- trazabilidad
- seguridad clinica
- evolucion hacia priorizacion contextual y analitica avanzada con ICEA+

La evolucion correcta del sistema no es "mas pantallas", sino:
1. un **nucleo comun universal**
2. perfiles clinicos por unidad
3. overlays por especialidad
4. motor de priorizacion/anticipacion explicable
5. capa analitica ICEA+ ajustada por case-mix

---

# 3) MODELO ARQUITECTONICO OBJETIVO

## 3.1. HANDOVER Core
Es la base comun y universal del relevo enfermero.

Debe contener, como minimo:
- identificacion del paciente / encuentro
- unidad / turno / profesional
- SBAR
- signos vitales / escalas transversales
- problemas activos
- medicacion / tratamientos
- dispositivos
- riesgos
- pendientes
- resumen / cierre del relevo

### Regla
El Core debe seguir siendo unico.
No se debe fragmentar el Core por servicio.

## 3.2. Unit Profile Packs (UPP)
Cada unidad clinica debe implementarse como **perfil configurable**, no como formulario independiente.

Cada UPP debe definir:
- campos extra minimos
- escalas especificas
- eventos criticos centinela
- reglas de visibilidad
- quick-picks / catalogos
- logica de prioridad contextual
- salidas visibles para enfermeria
- variables exportables para ICEA+

### Ejemplos de unidades
- UCI / criticos
- Medicina Interna
- Urgencias
- Oncologia
- Pediatria
- Quirurgico / recuperacion
- Materno-perinatal
- Neonatologia
- Salud mental
- Rehabilitacion
- Geriatria / larga estadia
- Atencion domiciliaria
- Hospitalizacion general
- Observacion / resucitacion

## 3.3. Specialty Overlay Packs (SOP)
Las especialidades no deben romper el perfil base de unidad.
Deben montarse como **overlays** sobre una unidad base.

Ejemplos:
- cardiologia
- neumologia
- nefrologia
- neurologia
- endocrinologia
- hematologia
- infectologia
- digestivo
- traumatologia
- cirugia general
- oncologia medica
- oncologia quirurgica
- cuidados paliativos
- pediatria oncologica
- obstetricia
- ginecologia
- etc.

### Regla
Una especialidad modifica, anade o pondera:
- campos relevantes
- eventos criticos
- catalogos
- reglas MPAC
- expectativas ICEA+

Pero no crea un "nuevo HANDOVER".

## 3.4. MPAC = Motor de Priorizacion y Anticipacion Contextual
MPAC debe ser transversal y explicable.

No debe empezar como caja negra.
La secuencia correcta es:

1. reglas clinicas explicitas
2. pesos contextuales por perfil
3. ranking explicable
4. alertas contextuales
5. validacion clinica
6. solo despues: ML/XAI si procede

### Principio
La prioridad enfermera no es igual a la gravedad medica.

Debe considerar, como minimo:
- inestabilidad actual
- riesgo de deterioro proximo
- dependencia / vigilancia requerida
- carga terapeutica
- criticidad temporal de pendientes
- riesgo de omision
- complejidad de coordinacion
- modificadores de unidad
- modificadores de especialidad

### Restriccion
Toda salida de MPAC debe poder explicar **por que** prioriza.

## 3.5. ICEA+ Layer
ICEA+ no mide "cantidad de campos" ni "cantidad de tareas".

Debe consumir variables comparables y ajustadas por contexto para estimar:
- complejidad basal
- intensidad de vigilancia
- carga terapeutica
- criticidad temporal
- continuidad del cuidado
- intervencion realizada
- resultado observado
- contribucion enfermera ajustada
- valor / coste evitado cuando aplique

### Regla critica
No comparar unidades sin **case-mix adjustment**.

Toda comparacion entre unidades, turnos o equipos debe controlar al menos:
- severidad basal
- comorbilidad
- agudeza
- dependencia
- contexto asistencial
- recursos / skill-mix cuando aplique

---

# 4) REGLAS DE DISENO CLINICO

## 4.1. No sobrecargar a enfermeria
La evolucion del sistema debe reducir carga cognitiva y riesgo de omision.
Nunca debe anadir documentacion redundante sin valor claro.

## 4.2. No duplicar registro
Si un dato ya existe:
- en el Core
- en la HCE
- en FHIR
- en otro campo estructurado
- en contexto de turno

no volver a pedirlo salvo necesidad clinica justificada.

## 4.3. Visible solo lo relevante
Cada perfil debe mostrar solo lo que aporta valor al turno.

## 4.4. Humano en el circuito
Las sugerencias IA apoyan.
La decision clinica final sigue siendo humana.

## 4.5. Trazabilidad
Toda inferencia relevante debe poder rastrearse a:
- datos fuente
- perfil activo
- reglas/pesos aplicados
- version del sistema
- usuario / turno

---

# 5) REGLAS DE IMPLEMENTACION EN CODIGO

## 5.1. Estructura preferida
Favorecer:
- catalogos tipados
- config maps
- discriminated unions
- factories/adapters
- hooks/componentes reutilizables
- validacion con Zod / esquemas existentes
- serializacion consistente hacia FHIR

Evitar:
- condicionales gigantes por unidad dentro de una sola pantalla
- hardcode disperso de strings clinicos
- forks completos del formulario
- logica clinica mezclada arbitrariamente con UI

## 5.2. Contratos
Toda nueva entidad de perfil debe tener contratos claros para:
- frontend form visibility
- validation
- mapping
- prioritization
- ICEA export
- tests

## 5.3. Cambios full-stack coherentes
Si se toca perfil clinico, revisar segun corresponda:
- tipos TS
- config/flags
- schemas
- componentes UI
- mapping FHIR
- endpoints backend
- tests frontend
- tests backend
- README/docs

---

# 6) SEGURIDAD Y CUMPLIMIENTO

## 6.1. Seguridad no negociable
No introducir cambios que:
- relajen autenticacion DRF estandar
- permitan trust boundary roto en `/api/fhir/transaction`
- filtren detalles sensibles en errores
- dejen rutas AI/upload sin auth
- mantengan secretos en cliente
- debiliten auditoria o RBAC

## 6.2. Datos clinicos
- minimo privilegio
- minimo dato necesario
- sanitizacion de logs
- mensajes de error redactados
- no exponer PHI

## 6.3. Gobernanza IA
Toda logica de IA debe ser:
- explicable
- auditable
- clinicamente revisable
- no punitiva
- no discriminatoria
- gobernada por criterios clinicos reales

---

# 7) ORDEN PREFERENTE DE EVOLUCION DEL REPO

Cuando la tarea sea multiunidad/multiespecialidad, seguir preferentemente este orden:

## Fase A - Base estructural
1. catalogo maestro de unidades
2. catalogo maestro de especialidades
3. modelo formal UPP
4. modelo formal SOP
5. refactor de formulario para perfiles configurables

## Fase B - Logica clinica contextual
6. MPAC v1 hibrido y explicable
7. activacion progresiva de perfiles prioritarios:
   - UCI
   - Medicina Interna
   - Urgencias
   - Oncologia
   - Quirurgico
   - Materno-perinatal
   - Pediatria

## Fase C - Analitica
8. contrato de exportacion ICEA+ por perfil
9. case-mix adjustment base
10. dashboards/analitica solo despues de contratos estables

## Fase D - Endurecimiento
11. tests de perfiles
12. tests de visibilidad
13. tests MPAC
14. tests FHIR
15. docs / README / runbooks

---

# 8) DEFINICION DE HECHO (DEFINITION OF DONE)

Un cambio esta realmente terminado solo si:

- compila
- pasa tests relevantes
- no rompe flujos existentes
- no rompe mapping FHIR
- no introduce huecos de seguridad
- actualiza contratos/tipos/esquemas
- documenta comportamiento visible nuevo
- no deja logica medio conectada
- no crea duplicacion estructural evitable

---

# 9) FORMATO ESPERADO DE ENTREGA EN CADA TAREA

Al terminar una tarea, devolver siempre:

1. resumen breve de lo implementado
2. archivos modificados
3. decisiones clinicas/tecnicas relevantes
4. pruebas ejecutadas
5. riesgos o follow-ups reales, si los hay

No inventar que algo quedo "production-ready" si no lo esta.

---

# 10) REGLAS ESPECIALES PARA PROMPTS QUIRURGICOS

Cuando una instruccion del usuario pida "cirugia", "quirurgico", "sin romper nada", "no reinventar", "hazlo bien" o equivalente, asumir automaticamente:

- minimizar superficie de cambio
- preservar contratos existentes
- preferir refactor aditivo
- validar extremo a extremo
- no esconder problemas reales
- no declarar exito sin evidencia

---

# 11) HEURISTICA DE DECISION PARA CUALQUIER AGENTE

Antes de modificar codigo, preguntarse internamente:

1. Esto extiende el Core o intenta duplicarlo?
2. Esto deberia ser UPP, SOP o logica MPAC?
3. Estoy creando un formulario paralelo innecesario?
4. Estoy metiendo IA donde aun faltan reglas y contratos?
5. ICEA+ podra leer esto de forma comparable y con case-mix?
6. Estoy debilitando la seguridad o el trust boundary?
7. La enfermera vera menos ruido o mas carga?

Si alguna respuesta es problematica, redisenar antes de codificar.

---

# 12) PRINCIPIO RECTOR FINAL

La direccion correcta del proyecto es:

**un nucleo comun de relevo, multiples perfiles clinicos configurables, priorizacion contextual explicable y una capa ICEA+ ajustada por case-mix.**

Nunca convertir HANDOVER en una coleccion de formularios independientes por servicio.
