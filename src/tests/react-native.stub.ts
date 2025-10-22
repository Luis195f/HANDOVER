export const Platform = { OS: "test" };
export const NativeModules = {};
export class NativeEventEmitter {}
const subs = new Set<(...a: any[]) => void>();
export const AppState = {
  addEventListener: (_: string, fn: (...a: any[]) => void) => {
    subs.add(fn);
    return { remove: () => subs.delete(fn) };
  },
  removeEventListener: (_: string, fn: (...a: any[]) => void) => subs.delete(fn),
  __emit: (...a: any[]) => subs.forEach((fn) => fn(...a)),
};
export default { Platform, NativeModules, NativeEventEmitter, AppState };
