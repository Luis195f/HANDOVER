export class EventEmitter {
  addListener() { return { remove() {} }; }
  removeAllListeners() {}
}
export function requireNativeModule<T = any>(_name: string): T {
  // Devuelve un objeto vacío para cualquier módulo nativo
  return {} as T;
}
export const NativeModulesProxy: any = {};
export default { EventEmitter, requireNativeModule, NativeModulesProxy };
