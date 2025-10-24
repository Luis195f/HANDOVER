declare module 'zod' {
  export type ZodTypeAny = any;
  export type RefinementCtx = { addIssue(issue: { code: string; message?: string }): void };
  export type infer<T> = any;
  export type output<T> = any;

  export function object<T extends Record<string, any>>(shape: T): any;
  export function string(): any;
  export function number(): any;
  export function boolean(): any;
  export function literal<T>(value: T): any;
  export function array<T>(schema: T): any;
  export function union<T extends any[]>(schemas: T): any;
  export function nativeEnum<T>(en: T): any;
  export function record<T>(value: T): any;
  export function any(): any;
  export function unknown(): any;
  export function lazy<T>(getter: () => T): any;
  export function effect<T>(schema: T, effect?: any): any;

  export const ZodIssueCode: { custom: string };

  export const z: {
    object: typeof object;
    string: typeof string;
    number: typeof number;
    boolean: typeof boolean;
    literal: typeof literal;
    array: typeof array;
    union: typeof union;
    nativeEnum: typeof nativeEnum;
    record: typeof record;
    any: typeof any;
    unknown: typeof unknown;
    lazy: typeof lazy;
    effect: typeof effect;
    preprocess: (...args: any[]) => any;
    optional: (schema: any) => any;
    nullable: (schema: any) => any;
    default: (schema: any, value: any) => any;
    refine: (schema: any, refinement: any) => any;
    transform: (schema: any, transformer: any) => any;
    enum: (vals: any) => any;
    void: () => any;
    never: () => any;
    coerce: { number: () => any; boolean: () => any };
    infer: <T>(schema: T) => any;
    output: <T>(schema: T) => any;
    ZodIssueCode: typeof ZodIssueCode;
  };

  export { z as default };
  export { z };
}
