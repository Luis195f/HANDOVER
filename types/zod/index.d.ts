declare module 'zod' {
  export type infer<T> = any;
  export type output<T> = any;
  export type ZodTypeAny = any;
  export type ZodType<T = any> = any;
  export type ZodSchema<T = any> = any;
  export type RefinementCtx = any;
  export type ZodEffects<T = any> = any;
  export type ZodEnum<T extends [string, ...string[]]> = any;
  declare const z: any;
  export { z };
  export default z;
  export namespace z {
    type infer<T> = any;
    type output<T> = any;
    type ZodTypeAny = any;
    type ZodType<T = any> = any;
    type ZodSchema<T = any> = any;
    type ZodEffects<T = any> = any;
    type ZodEnum<T extends [string, ...string[]]> = any;
  }
}
