type JestMockFn<T extends (...args: any[]) => any> = T & {
  mockImplementation(fn: T): JestMockFn<T>;
  mockImplementationOnce(fn: T): JestMockFn<T>;
  mockResolvedValue(value: any): JestMockFn<T>;
  mockResolvedValueOnce(value: any): JestMockFn<T>;
  mockReturnValue(value: any): JestMockFn<T>;
  mockReset(): JestMockFn<T>;
  mock: { calls: any[]; results?: any[] };
};

declare const jest: {
  fn<T extends (...args: any[]) => any>(implementation?: T): JestMockFn<T>;
  spyOn<T extends object, K extends keyof T>(object: T, method: K): JestMockFn<T[K]>;
  mock(moduleName: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  requireMock(moduleName: string): any;
  resetModules(): void;
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
  runAllTimers(): void;
  runOnlyPendingTimers(): void;
  clearAllMocks(): void;
};

declare namespace jest {
  type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = JestMockFn<T>;
}

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
  resolves: {
    toBe(value: any): Promise<void>;
    toEqual(value: any): Promise<void>;
  };
  rejects: {
    toThrow(message?: any): Promise<void>;
    toMatch(value: any): Promise<void>;
  };
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
  toHaveBeenCalledTimes(times: number): void;
  toBeNull(): void;
  toBeUndefined(): void;
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
