// __mocks__/expo-modules-core.ts
// Stub MUY simple de expo-modules-core para que Vitest no intente
// usar NativeModules / EventEmitter reales de React Native en Node.

export type EventCallback = (...args: any[]) => void;

export class EventEmitter {
  private listeners: Record<string, EventCallback[]> = {};

  constructor(_target?: any) {}

  addListener(eventName: string, listener: EventCallback) {
    if (!this.listeners[eventName]) this.listeners[eventName] = [];
    this.listeners[eventName].push(listener);
    return {
      remove: () => this.removeListener(eventName, listener),
    };
  }

  removeAllListeners(eventName?: string) {
    if (eventName) {
      delete this.listeners[eventName];
    } else {
      this.listeners = {};
    }
  }

  removeListener(eventName: string, listener: EventCallback) {
    const arr = this.listeners[eventName];
    if (!arr) return;
    this.listeners[eventName] = arr.filter((l) => l !== listener);
  }

  emit(eventName: string, ...args: any[]) {
    const arr = this.listeners[eventName];
    if (!arr) return;
    for (const l of arr) l(...args);
  }
}

// Lo mínimo que usan algunos módulos de Expo. En tests será NO-OP.
export const NativeModulesProxy: Record<string, any> = {
  ExpoModulesCoreJSLogger: {
    // En el error que te da, intenta hacer algo como `.get(...)`,
    // así que aquí devolvemos un objeto vacío para que no reviente.
    get: () => ({}),
    log: () => {},
  },
};

// En entorno de tests devolvemos módulos nativos vacíos.
export function requireNativeModule<T = any>(_moduleName: string): T {
  return {} as T;
}

export function requireOptionalNativeModule<T = any>(
  _moduleName: string,
): T | null {
  return null;
}
