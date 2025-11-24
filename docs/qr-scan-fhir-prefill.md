# Escaneo de QR con precarga FHIR

Este flujo permite leer códigos QR y precargar datos clínicos desde FHIR antes de abrir el formulario de relevo. Reutiliza `CameraView`, `usePatientSummary` y `prefillFromFHIR` para minimizar lógica duplicada.

## Formatos de códigos QR admitidos

1. **URL**
   - Ejemplos: `https://fhir.server.com/Patient/<ID>`, `handover://patient/<ID>`.
   - Se extrae el `patientId` con una expresión regular `/(?:Patient|patient)\/([^/?#]+)/`.
   - Si la URL es HTTPS se usa su _origin_ (y ruta previa a `/Patient/`) como `server` FHIR.

2. **JSON codificado como cadena**
   - Ejemplo: `{"patientId":"12345","unit":"UCI","bed":"12A"}`.
   - Se valida que la cadena empiece por `{` y termine por `}` antes de llamar a `JSON.parse`.
   - Campos soportados: `patientId` (requerido), `unit`, `bed`, `server` (FHIR base), `visitId` y futuros metadatos.

> Si el payload no coincide con ninguno de estos formatos, se muestra `Alert.alert('QR inválido', 'El código no contiene datos de paciente')` y se reactiva el escaneo.

## Flujo en `QRScan`

- `CameraView` mantiene `barcodeScannerSettings` restringido a `['qr']`.
- `handleBarcodeScanned` desactiva lecturas múltiples (`scanned=true`), parsea el payload y guarda un objeto con `patientId`, `server`, `unit`, `bed` y `visitId`.
- `usePatientSummary(patientId)` muestra un `PatientBanner` con nombre/edad/cama mientras se consulta el FHIR configurado.
- Al mismo tiempo, `prefillFromFHIR` intenta precargar ubicación, signos vitales y diagnósticos usando:
  - `server` del QR si existe, o `EXPO_PUBLIC_FHIR_BASE_URL`/`FHIR_BASE_URL`.
  - `session.accessToken` como token Bearer.
- En caso de fallo (404 o red) se muestra un mensaje y un botón **Reintentar precarga**. El usuario puede continuar igualmente en modo offline.
- Al pulsar **Continuar con entrega** se navega a `HandoverForm` pasando `patientId`, `patientSummary`, `prefilledValues` y `prefillMeta` (server/unit/bed/visitId).

## Inicialización del formulario

- `HandoverForm` acepta `prefilledValues` y `patientSummary` como props de navegación.
- Los valores prellenados se inyectan en `defaultValues` (ID paciente, diagnóstico principal y signos vitales). `administrativeData.unit` también usa `prefillMeta.unit` o `prefilledValues.location` como respaldo.
- `PatientBanner` del formulario prioriza el resumen recibido por navegación y evita recargar mientras ese dato existe.

## Modo offline y errores

- Si no hay permisos de cámara, se muestra un CTA para reintentar.
- Ante errores de parseo o paciente no encontrado se reactivan los controles de re-escaneo.
- Si falla la precarga FHIR, el usuario puede continuar con el formulario y editar manualmente; `prefillFromFHIR` ya devuelve estructuras seguras vacías para no bloquear la UI.
