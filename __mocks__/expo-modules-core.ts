// __mocks__/expo-modules-core.ts
// Stub ligero pero "creíble" de expo-modules-core para entorno de tests (Vitest)

export type EventSubscription = { remove: () => void };

export class EventEmitter<T = any> {
  private listeners = new Map<string, Set<(event: T) => void>>();

  addListener(eventName: string, listener: (event: T) => void): EventSubscription {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(listener);

    return {
      remove: () => {
        this.listeners.get(eventName)?.delete(listener);
      },
    };
  }

  removeAllListeners(eventName?: string) {
    if (typeof eventName === 'string') {
      this.listeners.delete(eventName);
    } else {
      this.listeners.clear();
    }
  }

  emit(eventName: string, event: T) {
    this.listeners.get(eventName)?.forEach((listener) => listener(event));
  }
}

// Simula el objeto de módulos nativos
export const NativeModulesProxy: Record<string, any> = {};

// 🔴 CLAVE: exportar Platform porque expo-av lo pide
export const Platform = {
  OS: 'web' as 'web' | 'ios' | 'android',
  select<T>(spec: {
    ios?: T;
    android?: T;
    web?: T;
    native?: T;
    default?: T;
  }): T | undefined {
    return spec.web ?? spec.native ?? spec.default;
  },
};

// Stub de requireNativeViewManager: devuelve un componente tonto
export function requireNativeViewManager(_viewName: string): any {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const DummyComponent = () => null;
  return DummyComponent;
}

// Algunas APIs lo llaman para registrar el root component: no hacemos nada
export function registerRootComponent<T>(component: T): T {
  return component;
}

// Default export con todo junto
const defaultExport = {
  NativeModulesProxy,
  EventEmitter,
  Platform,
  requireNativeViewManager,
  registerRootComponent,
};

export default defaultExport;
