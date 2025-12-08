# Cobertura actual (observaciones rápidas)

- **QR / escaneo**
  - Tests existentes: `tests/qr-scan.test.ts` (helpers `extractPatientId` y `handleScanResult`).
  - Huecos: pantalla `QRScan.tsx` sin cobertura (permisos, estados de precarga, navegación tras escaneo, QR inválido).

- **HandoverForm**
  - Tests existentes: encabezado de paciente, secciones SBAR/AI, firmas (`tests/screens/HandoverForm.*`, `tests/handover-form.*`).
  - Huecos: validaciones Zod de campos obligatorios, envío exitoso con datos completos, manejo offline (enqueue), errores por valores fuera de rango.

- **Cola offline / sync**
  - Tests existentes: `tests/queue/offline-queue.spec.ts`, `tests/sync.spec.ts`, `tests/offline-sync.spec.ts`.
  - Huecos: flujos diferenciados por estado de red (offline→online), manejo de HTTP 502/503/504, agotamiento de reintentos y permanencia en cola según respuesta.
