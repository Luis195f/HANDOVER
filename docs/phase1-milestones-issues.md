# Fase 1 – Mínimos técnicos para validación clínica

Este documento define los milestones y issues propuestos para la Fase 1 del proyecto handover-pro. Cada issue incluye etiquetas, checklist de tareas y criterios de aceptación, siguiendo las convenciones solicitadas.

## Milestone 1: F1-M1 – Autenticación segura (MVP)

**Descripción:** Implementar autenticación segura mínima (mock OAuth2/SSO) con login obligatorio, tokens almacenados de forma cifrada y navegación protegida para poder usar la app en un piloto clínico.

**Etiquetas clave:** `fase-1`, `security`, `auth`.

### Issues del milestone

#### Issue F1-01 – Definir estrategia de autenticación y proveedor (mockable)
- **Labels:** `fase-1`, `auth`, `security`, `design`
- **Checklist de tareas:**
  - [ ] Documentar opciones de proveedor (Firebase Auth, Auth0, API OAuth2 del hospital).
  - [ ] Definir interfaz `AuthProvider` en `src/lib/auth/types.ts` con métodos `login(credentials)`, `logout()`, `refreshToken()`, `getCurrentUser()`.
  - [ ] Planificar uso inicial de un provider mock local siguiendo dicha interfaz.
  - [ ] Documentar la decisión en `docs/auth-strategy.md` (o actualizar `README.md`).
- **Criterios de aceptación:**
  - Existe interfaz `AuthProvider` tipada en TypeScript (sin `any`).
  - El issue documenta el flujo mock inicial y cómo se integrará un proveedor real a futuro.

#### Issue F1-02 – Implementar AuthService con almacenamiento seguro de tokens
- **Labels:** `fase-1`, `auth`, `security`
- **Checklist de tareas:**
  - [ ] Crear `src/lib/auth/AuthService.ts` que implemente `AuthProvider` usando un provider mock.
  - [ ] Integrar `expo-secure-store` u opción equivalente para almacenar tokens cifrados.
  - [ ] Definir tipos `AuthToken`, `AuthUser`, `AuthState` en módulos apropiados.
  - [ ] Exponer hooks o utilidades (`useAuth`, `getAuthState`) accesibles desde las pantallas.
- **Criterios de aceptación:**
  - Los tokens no se guardan en `AsyncStorage` plano.
  - `AuthService` exporta sólo tipos explícitos (sin `any`).
  - Existe forma de recuperar el usuario actual y validar la sesión.

#### Issue F1-03 – Pantalla de Login y navegación protegida
- **Labels:** `fase-1`, `auth`, `ui`
- **Checklist de tareas:**
  - [ ] Crear `src/screens/LoginScreen.tsx` con formulario de usuario/contraseña usando `react-hook-form`.
  - [ ] Conectar el formulario al `AuthService` mock.
  - [ ] Actualizar `src/navigation/RootNavigator.tsx` (o archivo equivalente) para mostrar `LoginScreen` si no hay sesión válida.
  - [ ] Añadir botón “Cerrar sesión” en la pantalla principal para ejecutar `logout()` y limpiar estado.
- **Criterios de aceptación:**
  - Sin login no es posible acceder a `src/screens/HandoverForm.tsx` ni a las listas de pacientes.
  - Tras login exitoso, la app navega a la pantalla principal actual.
  - Cerrar sesión invalida tokens y regresa a la pantalla de login.

#### Issue F1-04 – Integrar autenticación en fhir-client y sync
- **Labels:** `fase-1`, `auth`, `offline-sync`, `backend`
- **Checklist de tareas:**
  - [ ] Modificar `src/lib/fhir-client.ts` para incluir el header `Authorization: Bearer <access_token>` obteniéndolo de `AuthService`.
  - [ ] Asegurar que la cola offline (`src/lib/sync.ts`, `src/lib/offlineQueue.ts`) sólo sincronice si la sesión es válida.
  - [ ] Definir el comportamiento ante respuestas `401/403` (forzar re-login o usar `refreshToken`).
- **Criterios de aceptación:**
  - Las llamadas FHIR usan el token vigente si existe.
  - El flujo ante token inválido está documentado (no queda en error silencioso).
  - No se usan `any` en las respuestas de autenticación.

---

## Milestone 2: F1-M2 – Administración de turno completa

**Descripción:** Completar la sección administrativa del turno en `HandoverForm` capturando personal entrante/saliente, fecha/hora inicio/fin, unidad/clase de turno y observaciones generales según el diseño clínico.

**Etiquetas recomendadas:** `fase-1`, `clinical-context`, `form`.

### Issues del milestone

#### Issue F1-10 – Extender modelo de datos de administración de turno
- **Labels:** `fase-1`, `clinical-context`, `types`
- **Checklist de tareas:**
  - [ ] Definir en `src/types/shift.ts` (o equivalente) la interfaz `ShiftAdminInfo` con campos `staffOut[]`, `staffIn[]`, `startDateTime`, `endDateTime`, `unitId`, `shiftType`, `generalNotes`.
  - [ ] Asegurar que los datos del formulario de handover incluyan `admin: ShiftAdminInfo`.
- **Criterios de aceptación:**
  - El modelo de datos del turno contempla todos los campos administrativos.
  - TypeScript compila sin errores tras la actualización.

#### Issue F1-11 – Completar sección Administrativa en HandoverForm
- **Labels:** `fase-1`, `clinical-context`, `ui`, `form`
- **Checklist de tareas:**
  - [ ] Crear en `src/screens/HandoverForm.tsx` la sección visual “Datos del turno” con campos para `staffOut`, `staffIn`, `startDateTime`, `endDateTime`, `unitId`, `shiftType`, `generalNotes`.
  - [ ] Conectar los campos a `react-hook-form` utilizando el tipo `ShiftAdminInfo`.
- **Criterios de aceptación:**
  - La sección administrativa es visible y utilizable en el formulario.
  - Al enviar, los datos administrativos se incluyen en la carga hacia la cola offline.

#### Issue F1-12 – Validación Zod para datos administrativos de turno
- **Labels:** `fase-1`, `clinical-context`, `validation`
- **Checklist de tareas:**
  - [ ] Crear esquema `shiftAdminSchema` con `zod` que valide que `startDateTime < endDateTime`, `unitId` obligatorio y al menos un enfermero en `staffOut` y `staffIn`.
  - [ ] Integrar el esquema en la validación del formulario (`HandoverForm`) mostrando mensajes de error claros.
- **Criterios de aceptación:**
  - No se puede guardar un turno sin unidad ni personal entrante/saliente.
  - Las fechas incoherentes bloquean el envío.

---

## Milestone 3: F1-M3 – Cifrado de datos locales sensibles

**Descripción:** Garantizar que todos los datos sensibles almacenados offline (cola FHIR, datos clínicos, notas) se guarden cifrados usando `SecureStore`, `crypto-js` u otra técnica equivalente.

**Etiquetas clave:** `fase-1`, `security`, `offline-sync`.

### Issues del milestone

#### Issue F1-20 – Inventario de datos locales sensibles
- **Labels:** `fase-1`, `security`, `offline-sync`
- **Checklist de tareas:**
  - [ ] Revisar `src/lib/sync.ts`, `src/lib/offlineQueue.ts` y otros módulos que utilicen almacenamiento local.
  - [ ] Documentar los tipos de datos almacenados (bundles FHIR, notas, audio, etc.) y marcar los sensibles.
  - [ ] Identificar claves/espacios que deben mantenerse cifrados y documentarlos en el issue o en comentarios técnicos.
- **Criterios de aceptación:**
  - Existe lista clara de claves/paths a cifrar.

#### Issue F1-21 – Migrar almacenamiento plano a almacenamiento cifrado
- **Labels:** `fase-1`, `security`, `offline-sync`
- **Checklist de tareas:**
  - [ ] Reemplazar `AsyncStorage` plano en la cola offline por `SecureStore` o por `AsyncStorage` + `crypto-js` con utilidades `encryptedSetItem` y `encryptedGetItem`.
  - [ ] Asegurar que bundles FHIR y datos clínicos se almacenan cifrados siempre.
- **Criterios de aceptación:**
  - Ningún dato clínico permanece en texto legible en el almacenamiento local.
  - La app sigue funcionando offline/online como antes.

#### Issue F1-22 – Tests básicos de cifrado de cola offline
- **Labels:** `fase-1`, `security`, `tests`
- **Checklist de tareas:**
  - [ ] Crear tests con Jest para las funciones de cifrado/descifrado.
  - [ ] Verificar que los datos almacenados no contienen texto en claro y que se recupera el bundle FHIR original.
- **Criterios de aceptación:**
  - Los tests pasan para casos de escritura/lectura cifrada.

---

## Milestone 4: F1-M4 – Sincronización offline robusta

**Descripción:** Refactorizar la cola offline y el módulo de sincronización para lograr persistencia robusta, reintentos exponenciales, timestamps y manejo de errores sin duplicación de datos.

**Etiquetas clave:** `fase-1`, `offline-sync`.

### Issues del milestone

#### Issue F1-30 – Refactor de módulo de cola offline (estructura y tipos)
- **Labels:** `fase-1`, `offline-sync`, `refactor`
- **Checklist de tareas:**
  - [ ] Unificar la lógica de cola en `src/lib/offlineQueue.ts` o módulo principal equivalente.
  - [ ] Definir tipos fuertes (`QueuedBundle`, `QueueStatus`, etc.).
  - [ ] Permitir agrupar recursos FHIR en `Bundle` por paciente/turno.
- **Criterios de aceptación:**
  - La cola offline utiliza tipos explícitos y un único punto de entrada para operaciones.

#### Issue F1-31 – Reintentos y timestamps en sincronización offline
- **Labels:** `fase-1`, `offline-sync`, `resilience`
- **Checklist de tareas:**
  - [ ] Añadir campos `attemptCount`, `firstEnqueuedAt`, `lastAttemptAt` a cada elemento de cola.
  - [ ] Implementar reintentos con backoff exponencial (1 min, 5 min, 15 min...).
  - [ ] Registrar en logs los reintentos y fallos.
- **Criterios de aceptación:**
  - Los reintentos respetan el backoff configurado.
  - Cada elemento de cola registra su historial básico de intentos.

#### Issue F1-32 – Manejo de errores y prevención de duplicados
- **Labels:** `fase-1`, `offline-sync`, `resilience`
- **Checklist de tareas:**
  - [ ] Asegurar IDs estables para cada recurso/bundle evitando duplicados en el servidor.
  - [ ] Definir reglas de eliminación de elementos de cola y tratamiento de errores `4xx` vs `5xx`.
  - [ ] Implementar manejo diferenciado: `4xx` graves → marcar como fallido; `5xx`/errores de red → reintentar.
- **Criterios de aceptación:**
  - No se duplican recursos al recuperar conexión.
  - Los errores se registran para facilitar la depuración.

#### Issue F1-33 – Tests de flujo offline/online con cola
- **Labels:** `fase-1`, `offline-sync`, `tests`
- **Checklist de tareas:**
  - [ ] Crear tests con Jest que cubran fallos de red, permanencia en cola y reenvío exitoso sin duplicados.
  - [ ] Probar combinación con autenticación: manejo cuando expira el token durante la sincronización.
- **Criterios de aceptación:**
  - Los tests pasan para los escenarios básicos offline/online definidos.

---

## Orden recomendado de implementación

1. Issues F1-01 → F1-04 (Autenticación segura, milestone F1-M1).
2. Issues F1-10 → F1-12 (Administración de turno, milestone F1-M2).
3. Issues F1-20 → F1-22 (Cifrado local, milestone F1-M3).
4. Issues F1-30 → F1-33 (Sincronización robusta, milestone F1-M4).

Este orden prioriza la habilitación de acceso seguro, la captura completa de datos administrativos, la protección de datos locales y finalmente la robustez de la sincronización offline.
