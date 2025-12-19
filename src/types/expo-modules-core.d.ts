declare module 'expo-modules-core' {
  export interface PermissionResponse {
    granted: boolean;
    status?: string;
    canAskAgain?: boolean;
    expires?: string | number;
  }

  export class NativeModule<TEvents = any> {
    [key: string]: any;
    constructor(options?: any);
    addListener?(eventName: keyof TEvents, listener: (...args: any[]) => void): EventSubscription;
    removeListeners?(count: number): void;
  }

  export interface EventSubscription {
    remove(): void;
  }

  export class UnavailabilityError extends Error {}

  export function requireOptionalNativeModule<T = any>(moduleName: string): T | null;

  export const uuid: { v4: () => string };
}
