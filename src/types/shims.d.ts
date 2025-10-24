declare module '*';

declare const __DEV__: boolean;

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare var process: {
  env: Record<string, string | undefined> & {
    NODE_ENV?: string;
    EXPO_PUBLIC_API_BASE?: string;
    EXPO_PUBLIC_API_TOKEN?: string;
    EXPO_PUBLIC_FHIR_BASE?: string;
    API_BASE?: string;
    API_TOKEN?: string;
    BYPASS_SCOPE?: string;
    EXPO_PUBLIC_BYPASS_SCOPE?: string;
  };
};

declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearInterval(handle?: any): void;

declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function expect(actual: any): any;
