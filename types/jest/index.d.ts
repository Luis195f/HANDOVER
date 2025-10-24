declare const jest: {
  fn<T extends (...args: any[]) => any>(implementation?: T): T & { mockImplementation(fn: T): void } & { mockResolvedValue(value: any): void } & { mockReturnValue(value: any): void };
  spyOn<T extends object, K extends keyof T>(object: T, method: K): any;
  mock(moduleName: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  useFakeTimers(): void;
  advanceTimersByTime(ms: number): void;
  runAllTimers(): void;
  clearAllMocks(): void;
};

declare module '*';

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
