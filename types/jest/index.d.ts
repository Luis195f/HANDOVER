declare const jest: {
  fn<T extends (...args: any[]) => any>(implementation?: T): T & {
    mockImplementation(fn: T): void;
    mockResolvedValue(value: any): void;
    mockReturnValue(value: any): void;
    mockResolvedValueOnce(value: any): void;
  };
  spyOn<T extends object, K extends keyof T>(object: T, method: K): any;
  mock(moduleName: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
  runAllTimers(): void;
  runOnlyPendingTimers(): void;
  clearAllMocks(): void;
};

declare function describe(name: string, fn: () => void | Promise<void>): void;
declare namespace describe {
  function skip(name: string, fn: () => void | Promise<void>): void;
  function only(name: string, fn: () => void | Promise<void>): void;
}

declare function it(name: string, fn: () => void | Promise<void>): void;
declare namespace it {
  function skip(name: string, fn: () => void | Promise<void>): void;
  function only(name: string, fn: () => void | Promise<void>): void;
}

declare const test: typeof it;

declare function beforeAll(fn: () => void | Promise<void>): void;
declare function afterAll(fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;

interface JestExpect {
  not: JestExpect;
  toBe(value: any): void;
  toEqual(value: any): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(value: any): void;
  toBeGreaterThanOrEqual(value: number): void;
  toBeGreaterThan(value: number): void;
  toMatchSnapshot(): void;
  toMatch(value: any): void;
  toThrow(): void;
  toBeDefined(): void;
  toHaveLength(value: number): void;
  toContainEqual(value: any): void;
  toBeLessThanOrEqual(value: number): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledWith(...args: any[]): void;
}

declare function expect(value: any): JestExpect;

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
