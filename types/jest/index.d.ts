export {};
declare global {
  const jest: {
    fn<T extends (...args: any[]) => any>(impl?: T): T & {
      mockResolvedValue(value?: any): any;
      mockImplementation(impl: T): any;
      mockReturnValue(value: any): any;
      mockReturnValueOnce(value: any): any;
      mockRejectedValue(value: any): any;
      mockReset(): any;
    };
    spyOn<T extends object, M extends keyof T>(obj: T, method: M): {
      mockImplementation(impl: any): any;
      mockResolvedValue(value?: any): any;
      mockRejectedValue(value?: any): any;
    };
    useFakeTimers(): void;
    useRealTimers(): void;
    runOnlyPendingTimers(): void;
    runAllTimers(): void;
    clearAllMocks(): void;
  } & Record<string, any>;
  function describe(name: string, fn: () => void | Promise<void>): void;
  namespace describe {
    function skip(name: string, fn: () => void | Promise<void>): void;
  }
  function it(name: string, fn: () => void | Promise<void>): void;
  function test(name: string, fn: () => void | Promise<void>): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  function expect(actual: any): any;
}
