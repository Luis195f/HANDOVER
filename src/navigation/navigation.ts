// @ts-nocheck
import { createNavigationContainerRef, CommonActions, StackActions } from "@react-navigation/native";

export type RootStackParamList = {
  PatientList: undefined;
  HandoverForm: { patientId?: string } | undefined;
  SyncCenter: undefined;
};

// Ref tipado al root navigator
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Cola interna para llamadas hechas antes de que el contenedor esté listo.
const pending: Array<() => void> = [];

function flush() {
  if (!navigationRef.isReady()) return;
  while (pending.length) {
    try {
      const fn = pending.shift()!;
      fn();
    } catch {
      // evitamos que un error bloquee el resto de la cola
    }
  }
}

function runOrQueue(fn: () => void) {
  if (navigationRef.isReady()) fn();
  else pending.push(fn);
}

// Exponer hook simple para el onReady del NavigationContainer (opcional)
export function onReady() {
  flush();
}

// Estado/consulta básica
export function isReady() {
  return navigationRef.isReady();
}

/** Navega a una ruta tipada. Si el contenedor no está listo, se encola. */
export function navigate<N extends keyof RootStackParamList>(name: N, params?: RootStackParamList[N]) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params as any);
  } else {
    runOrQueue(() => navigate(name, params));
  }
}

/** Empuja una pantalla en el stack (Native Stack compatible). */
export function push<T extends keyof RootStackParamList>(
  name: T,
  params?: RootStackParamList[T]
): void {
  runOrQueue(() => {
    navigationRef.dispatch(
      typeof params === "undefined"
        ? StackActions.push(name as any)
        : StackActions.push(name as any, params as any)
    );
  });
}

/** Reemplaza la pantalla actual por otra. */
export function replace<T extends keyof RootStackParamList>(
  name: T,
  params?: RootStackParamList[T]
): void {
  runOrQueue(() => {
    navigationRef.dispatch(
      typeof params === "undefined"
        ? StackActions.replace(name as any)
        : StackActions.replace(name as any, params as any)
    );
  });
}

/** Vuelve atrás si es posible. Silencioso si no hay a dónde volver. */
export function goBack(): void {
  runOrQueue(() => {
    if (navigationRef.canGoBack()) navigationRef.goBack();
  });
}

/** Resetea el stack a una sola ruta. Útil tras login/logout. */
export function resetTo<T extends keyof RootStackParamList>(
  name: T,
  params?: RootStackParamList[T]
): void {
  runOrQueue(() => {
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: name as any, params: params as any }],
      })
    );
  });
}

/** Nombre de la ruta actual (si existe). */
export function getCurrentRouteName(): keyof RootStackParamList | undefined {
  return navigationRef.getCurrentRoute()?.name as keyof RootStackParamList | undefined;
}

/** Parámetros actuales (tipados). */
export function getCurrentParams<T extends keyof RootStackParamList>():
  | RootStackParamList[T]
  | undefined {
  return navigationRef.getCurrentRoute()?.params as RootStackParamList[T] | undefined;
}

/**
 * Espera hasta que el contenedor esté listo (polling ligero) o vence por timeout.
 * Devuelve true si quedó listo, false si expiró.
 */
export async function waitForReady(timeoutMs = 2000): Promise<boolean> {
  if (navigationRef.isReady()) {
    flush();
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (navigationRef.isReady()) {
        clearInterval(id);
        flush();
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        resolve(false);
      }
    }, 50);
  });
}

// API por defecto (cómodo para import default)
const api = {
  navigationRef,
  onReady,
  isReady,
  navigate,
  push,
  replace,
  goBack,
  resetTo,
  getCurrentRouteName,
  getCurrentParams,
  waitForReady,
};

export default api;

