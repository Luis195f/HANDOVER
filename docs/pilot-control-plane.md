# Control plane minimo de piloto HANDOVER

> Estado del documento
> - Estado: `pilot`.
> - Ultima revision: 2026-03-27.
> - Fuente de verdad / evidencia base: `backend/api/pilot_control.py`, `backend/api/views_pilot_control.py`, `backend/api/views_icea.py`, `backend/api/views_icea_bridge.py`, `backend/api/icea_bridge_service.py`, `src/config/pilotControl.ts`, `src/config/unitsConfig.ts`, `src/screens/HandoverForm.tsx`, `src/screens/PatientList.tsx`.
> - Limite abierto: el control plane sigue siendo `env` read-only resuelto por backend y consumido por endpoint solo lectura. No existe en el repo un panel mutable institucional ni una bitacora propia de cambios de estado escrita desde UI.

## 1) Objetivo

Formalizar un control operativo minimo y serio para el piloto HANDOVER sin reinventar la arquitectura:

- HANDOVER sigue siendo la capa operativa principal.
- ICEA permanece como analitica shadow, agregada y prudente mientras no se supere el umbral de calidad de dato definido por el piloto.
- El flujo clinico base debe seguir funcionando cuando analytics, insights o bloques admin se apagan.

## 2) Alcance real del control plane

El control plane actual gobierna, por `unidad`, `rol` y `entorno`, estas capacidades:

- `icea_bridge`
- `icea_immediate_scoring`
- `icea_enriched_scoring`
- `icea_patient_risk`
- `governed_nnn`
- `admin_analytics`
- `ai_suggestions`

No introduce:

- plataforma externa de feature management;
- multi-tenant nuevo;
- panel enterprise nuevo;
- escritura bidireccional hospitalaria total;
- score nominal individual o panel punitivo ICEA.

## 3) Semantica de flags

Cada capacidad usa una semantica explicita:

- `enabled`: disponible si el kill switch base tambien esta encendido.
- `disabled`: apagado por control plane aunque el kill switch base exista.
- `pilot`: disponible solo dentro del scope permitido del piloto.
- `demo`: disponible solo en entorno `demo`.
- `shadow`: la costura ICEA sigue activa para observabilidad o pipeline, pero no habilita superficies clinicas no aptas para shadow.

Efecto operativo de `rolloutStatus`:

- `go`: aplica el scope normal de unidad, rol, entorno y flags base.
- `pause`: fuerza las capacidades ICEA/analiticas a `shadow`; las superficies no aptas para shadow como `icea_patient_risk` quedan efectivamente desactivadas.
- `no-go`: desactiva de forma efectiva las capacidades del piloto gobernadas por este control plane, manteniendo la clinica base de HANDOVER.

Estados globales del rollout:

- `go`
- `pause`
- `no-go`

## 4) Configuracion minima soportada

Frontend:

- `EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE`
- `EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON`

Backend:

- `HANDOVER_DEPLOYMENT_MODE`
- `HANDOVER_PILOT_CONTROL_JSON`

Shape minimo soportado:

```json
{
  "pilotMode": "pilot",
  "rolloutStatus": "pause",
  "enabledUnits": ["icu-a", "icu-b"],
  "allowedRoles": ["nurse", "supervisor", "admin"],
  "environmentScope": ["pilot"],
  "explicitShadowModeForIcea": true,
  "features": {
    "icea_bridge": {
      "mode": "shadow",
      "enabledUnits": ["icu-a"],
      "allowedRoles": ["supervisor", "admin"],
      "environmentScope": ["pilot"]
    },
    "icea_patient_risk": {
      "mode": "pilot",
      "enabledUnits": ["icu-a"],
      "allowedRoles": ["nurse", "supervisor", "admin"],
      "environmentScope": ["pilot"]
    },
    "governed_nnn": {
      "mode": "pilot",
      "enabledUnits": ["icu-a"],
      "allowedRoles": ["nurse", "supervisor", "admin"]
    },
    "admin_analytics": {
      "mode": "shadow",
      "allowedRoles": ["supervisor", "admin"]
    }
  }
}
```

Reglas operativas:

- si una feature no declara scope propio, hereda el scope global;
- si el kill switch base esta apagado, la feature queda efectivamente desactivada aunque el modo sea `enabled` o `pilot`;
- `explicitShadowModeForIcea=true` fuerza modo shadow para capacidades ICEA;
- `governed_nnn` y `ai_suggestions` no se exponen en shadow mode;
- `admin_analytics` queda separada de permisos asistenciales.
- nombre canonico nuevo para el estado efectivo expuesto por API: `shadow`;
- compatibilidad legacy: el JSON de entorno sigue aceptando `shadowMode`, pero frontend y backend lo degradan a alias de entrada y no como contrato efectivo de salida.

## 5) Kill switches efectivos y fallback honesto

Principio operativo desde 2026-03-27:

- backend resuelve el estado efectivo y es la unica fuente de verdad para habilitar superficies de piloto;
- frontend consulta primero `GET /api/pilot-control/features`;
- `EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON` queda como fallback subordinado y conservador;
- si el endpoint falla o devuelve shape invalido, el cliente no habilita features por si solo;
- el fallback local puede mantener `pilotMode`, `mode` o `shadow` como contexto de degradacion, pero no puede activar una superficie sin confirmacion backend.

| Capacidad | Kill switch base | Resultado al apagar | Fallback clinico u operativo |
|---|---|---|---|
| ICEA bridge | `ENABLE_ICEA_BRIDGE` | no se encola/envia bridge analitico | HANDOVER mantiene FHIR, ETL y flujo clinico base |
| Immediate scoring | `ENABLE_ICEA_IMMEDIATE_SCORING` | no se solicita score inmediato | bundle clinico y persistencia siguen activos |
| Enriched scoring | `ENABLE_ICEA_ENRICHED_SCORING` | no hay seguimiento enriquecido | el piloto sigue con score provisional o sin score |
| Patient risk insights | `ENABLE_ICEA_PATIENT_RISK` | no se expone bedside risk | la valoracion enfermera sigue sin apoyo ICEA |
| Governed NNN | `SHOW_NIC_CODING` / `SHOW_NOC_OUTCOMES` | se oculta bloque gobernado | permanece texto libre y flujo clinico base |
| Admin analytics blocks | `ENABLE_ICEA_OPS_SUMMARY` / `ENABLE_ICEA_OPS_EVENTS` | se degradan vistas admin/ops | operacion asistencial intacta; JSON estable con `available=false` |
| AI suggestions | `AI_SUGGESTIONS_ENABLED` | se apaga apoyo IA | handover manual sin sugerencias |

## 6) Rollout por unidad, rol y entorno

### Unidades elegibles

Las unidades elegibles dependen de `enabledUnits` global y/o de cada feature. Si la lista queda vacia, el control plane no restringe por unidad y prevalece la costura base existente del repo.

### Roles elegibles

- operativo asistencial: `nurse`
- supervisión operativa: `supervisor`
- administracion tecnica: `admin`

Separacion aplicada en codigo:

- `admin_analytics` y el endpoint de resumen del piloto solo se exponen a `supervisor` o `admin`;
- el endpoint `patient-risk` puede seguir existiendo bajo gobernanza, pero shadow prudente no debe volverlo visible en la UI clinica de `nurse`;
- acciones administrativas sensibles continúan restringidas a `admin` donde ya lo estaba el repo.

### Entornos

Entornos soportados:

- `development`
- `demo`
- `test`
- `pilot`
- `production`

Regla prudente:

- `demo` solo sirve bloques demo;
- `pilot` puede dejar ICEA en `shadow`;
- `production` no implica activar analytics nominal por defecto; depende del JSON de control y de los kill switches base.

## 7) Endpoint de consulta activa

Rutas:

- `GET /api/pilot-control/features`
- `GET /api/pilot-control/summary`

### Endpoint canonico para cliente

`GET /api/pilot-control/features`

Caracteristicas:

- solo lectura;
- requiere autenticacion;
- usa los roles autenticados reales del request como contexto efectivo;
- admite `unitId` como query param;
- devuelve un mapa estable por nombre canonico de feature;
- cada feature expone al menos `enabled`, `shadow` y `pilotMode`;
- es la fuente primaria consumida por `src/config/pilotControl.ts`.

Shape efectivo esperado:

```json
{
  "requestedContext": {
    "unitId": "icu-a",
    "roles": ["nurse"]
  },
  "features": {
    "governed_nnn": {
      "enabled": true,
      "shadow": false,
      "pilotMode": "pilot",
      "mode": "pilot",
      "denialReason": null
    }
  }
}
```

### Endpoint operativo para supervisión

- `GET /api/pilot-control/summary`

Caracteristicas:

- solo lectura;
- requiere autenticacion;
- requiere rol `supervisor` o `admin`;
- admite `unitId` y `role`/`roles` como query params para evaluar el scope efectivo;
- devuelve `features`, `killSwitches`, contexto solicitado y el limite `stateChangeAuditLimit=env_backed_read_only_control_plane`.

Uso previsto:

- `features`: gating efectivo de frontend y comprobacion de que UI no habilita mas de lo autorizado por backend;
- verificacion institucional del estado efectivo antes de `go`, `pause` o `no-go`;
- soporte para runbooks y checklists de despliegue;
- no sustituye una bitacora formal de aprobaciones del comite.

## 8) Criterios de entrada

Antes de mover una unidad a `pilot` con capacidades activas:

- unidad incluida en `enabledUnits` o en el scope especifico de la feature;
- roles confirmados para la superficie a habilitar;
- kill switches base validados en entorno;
- datasets/licencias NNN confirmados si se quiere salir del fallback local;
- estabilidad minima del dato HANDOVER aceptada por el comite si se pretende activar cualquier capacidad ICEA fuera de `shadow`.

## 9) Criterios go / pause / no-go

### Go

- flujo clinico base estable;
- pruebas objetivo del seam en verde;
- `HANDOVER_PILOT_CONTROL_JSON` revisado;
- ICEA solo en `shadow` o con justificacion formal para cada surface habilitada;
- permisos operativos y analiticos verificados.

### Pause

- errores recurrentes de bridge u ops no criticos para la clinica;
- calidad de dato insuficiente para mantener `patient-risk`;
- necesidad de restringir rollout a menos unidades o menos roles.

### No-go

- dependencia de ICEA para completar el handover;
- `patient-risk` nominal o punitivo;
- ausencia de licencia/dataset al querer activar NNN gobernado completo;
- incapacidad de explicar el estado efectivo con el resumen de control plane y los env reales.

## 10) Rollback operativo

Rollback minimo y reversible:

1. poner la feature afectada en `disabled` o `shadow` dentro de `HANDOVER_PILOT_CONTROL_JSON`;
2. si hace falta corte duro, apagar el kill switch base correspondiente;
3. revalidar `GET /api/pilot-control/features` y, si aplica, `GET /api/pilot-control/summary`;
4. comprobar que el fallback visible coincide con el esperado en UI o endpoints admin;
5. documentar fuera del repo la decision institucional si el cambio afecta el estado formal del piloto.

## 11) Que permanece en demo, provisional o disabled

- `icea_enriched_scoring`: opt-in y no prerequisite del piloto;
- `icea_patient_risk`: debe permanecer desactivado o en scope muy acotado hasta confirmar calidad de dato;
- `governed_nnn`: depende de dataset/licencia; si no existe, la UI cae a texto libre/legacy;
- `admin_analytics`: disponible solo para supervision/admin y sin convertir ICEA en panel nominal;
- bitacora de cambios de estado del piloto: fuera del repo o documental; no existe UI mutable con auditoria dedicada.

## 12) Limites clinicos y regulatorios

- ICEA sigue siendo soporte analitico shadow, no diagnostico autonomo;
- el repo no audita aun los cambios de estado del piloto como entidad propia;
- no existe interoperabilidad hospitalaria bidireccional completa como requisito resuelto por este control plane;
- este paquete no declara cierre MDR total ni reemplaza aprobacion QMS.

## 13) Activacion segura recomendada

Secuencia minima:

1. definir `HANDOVER_DEPLOYMENT_MODE` y `EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE`;
2. cargar el JSON de control plane coherente en backend y, solo como compatibilidad subordinada, en frontend;
3. validar kill switches base segun entorno;
4. consultar `/api/pilot-control/features` y usar `/api/pilot-control/summary` para verificacion operativa ampliada;
5. ejecutar pruebas objetivo del seam;
6. recien entonces pasar a `go` para las unidades previstas.

Este documento deja un control plane utilizable para piloto, pero no maquilla el limite actual: la gobernanza institucional completa sigue dependiendo de procedimiento operativo y aprobacion fuera del repo.
