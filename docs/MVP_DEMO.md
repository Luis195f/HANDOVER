# Demo MVP avanzada: salud mental (Windows / PowerShell)

Este runbook prepara exclusivamente la presentación sintética de salud mental del 27-28 de agosto. Mantiene un único HANDOVER Core con el runtime `behavioral-health`; no utiliza Django, HCE/FHIR institucional, datos reales, IA externa, telemetría ni scoring/writeback ICEA.

Consulta también [`docs/behavioral-health-demo-scope.md`](./behavioral-health-demo-scope.md) para el alcance clínico prudente.

## Requisitos ya instalados

- Windows con PowerShell 7 (`pwsh`).
- Node.js y las dependencias del repositorio ya presentes en `node_modules`.
- Microsoft Edge instalado para smoke o contingencia headed.
- Rama exacta `release/mvp-advanced-demo-rc`.
- Puertos loopback `19006` y `19007` libres.

El launcher comprueba estos requisitos y nunca instala dependencias o navegadores. No modifica `.env` ni inicia Django.

## Arranque reproducible

Desde `C:\h\HANDOVER-COPIA-DEMO-2026-08-25`:

```powershell
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Start
```

El launcher inicia Expo Web real en:

```text
http://127.0.0.1:19006/
```

OIDC/API/FHIR sintéticos quedan limitados a `http://127.0.0.1:19007`. Las variables se aplican solo a los procesos hijos: demo activada, `EXPO_PUBLIC_E2E=false`, QR desactivado, ICEA desactivado, IA externa desactivada y telemetría Expo desactivada. El launcher espera HTML y un bundle JavaScript real mayor de 800 bytes antes de mostrar la URL y permanece en primer plano.

## Recorrido de 5-7 minutos

1. Pulsa **Entrar en modo demo** y señala el banner **Modo demo - datos ficticios**.
2. Abre **Psiquiatría y salud mental** y selecciona el paciente adulto sintético. No muestres ni menciones QR.
3. Explica el relevo único de continuidad, completa una evolución sintética y selecciona un diagnóstico SNOMED del catálogo.
4. Revisa el checklist del relevo y finaliza con la firma del actor A, siempre como demostración técnica con datos ficticios.
5. Cambia al actor B de demo, confirma su identidad y registra la atestación diferenciada.
6. Simula offline, finaliza para dejar el Bundle en cola y muestra el estado pendiente sin servicios institucionales.
7. Reconecta, abre el centro de sincronización y ejecuta el replay hasta vaciar la cola.

No presentar QR, integración institucional, datos reales, producción, validación clínica/regulatoria ni ICEA individual o punitivo.

## Cierre y limpieza

Con el launcher en primer plano, pulsa `Ctrl+C`; el bloque de cierre elimina todos sus procesos. Desde otra terminal también se puede ejecutar:

```powershell
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Stop
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Clean
```

`Stop` solo termina PIDs registrados por el launcher y valida su hora de inicio para evitar PID reutilizado. `Clean` solo elimina `.tmp\handover-demo` después de comprobar que la ruta continúa dentro del temporal ignorado del repositorio.

## Export local

```powershell
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Export
```

El export de Expo Web se crea en `.tmp\handover-demo\export`, comprueba HTML y assets JavaScript reales, y permanece ignorado por Git. Para otro nombre seguro dentro del mismo temporal:

```powershell
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Export -ExportName ensayo-27-agosto
```

## Contingencia con Edge

Si se necesita abrir la ruta real con navegador visible, usa Expo real y Playwright headed con el Edge instalado, sin descargar Chromium:

```powershell
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Start -OpenEdge
```

La opción usa exclusivamente `chromium.launch({ channel: 'msedge', headless: false })`. `Ctrl+C`, `Stop` y `Clean` también cierran Edge y sus procesos hijos.

## Recuperación de puertos

Primero ejecuta `Stop` y comprueba los listeners:

```powershell
pwsh -NoProfile -File .\demo\Start-HandoverDemo.ps1 Stop
Get-NetTCPConnection -State Listen -LocalPort 19006,19007 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

Si queda un listener y no existe estado del launcher, inspecciona su propietario antes de intervenir:

```powershell
$listener = Get-NetTCPConnection -State Listen -LocalPort 19006,19007 -ErrorAction Stop
Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" |
    Select-Object ProcessId,ParentProcessId,Name,CommandLine
```

No finalices un PID no atribuido al repositorio. El launcher se negará a arrancar mientras cualquiera de los dos puertos esté ocupado.

## Limitaciones declaradas

- Esta es una demo profesional sintética, no un despliegue productivo ni una validación clínica o regulatoria.
- El recorrido autorizado es únicamente el perfil de salud mental con QR desactivado.
- Perfiles web que habiliten QR pueden seguir dependiendo de la implementación CDN de `expo-camera`; no se muestran ni utilizan en esta presentación.
- El loopback responde contratos sintéticos mínimos y no sustituye Django, OIDC, FHIR/HCE ni servicios institucionales.
- ICEA writeback/scoring, IA externa y telemetría están desactivados; no se presenta scoring individual, nominal o punitivo.
