// Expo "raíz". Algunas libs (o bundlers) buscan requireNativeModule aquí.
export const registerRootComponent = (_: any) => {};
export const requireNativeModule = <T = any>(_name: string): T => ({} as T);
export default { registerRootComponent, requireNativeModule };
