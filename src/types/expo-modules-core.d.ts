declare module 'expo-modules-core' {
  export interface PermissionResponse {
    granted: boolean;
    status?: string;
    canAskAgain?: boolean;
    expires?: string | number;
  }

  export class NativeModule<TEvents = Record<string, unknown>> {
    [key: string]: unknown;
    constructor(options?: Record<string, unknown>);
    addListener?(eventName: keyof TEvents, listener: (...args: unknown[]) => void): EventSubscription;
    removeListeners?(count: number): void;
  }

  export interface EventSubscription {
    remove(): void;
  }

  export class UnavailabilityError extends Error {}

  export function requireOptionalNativeModule<T = unknown>(moduleName: string): T | null;

  export const uuid: { v4: () => string };
}
