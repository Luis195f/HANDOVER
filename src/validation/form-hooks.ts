// FILE: src/validation/form-hooks.ts
// --------------------------------------------------
// useZodForm: React Hook Form + Zod, con:
// - Overloads → admite (schema, defaults) o (schema, options)
// - Tipado fuerte con z.output<TSchema>
// - Defaults conservadores para no romper UX
// --------------------------------------------------

import {
  useForm,
  type DefaultValues,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z, type ZodTypeAny, type output, type input } from "zod";

// Helpers de tipos (cómodos en componentes)
export type ZodInput<TSchema extends ZodTypeAny> = input<TSchema>;
export type ZodOutput<TSchema extends ZodTypeAny> = output<TSchema>;
export type InferSchema<TSchema extends ZodTypeAny> = z.infer<TSchema>;

// Opciones permitidas (subset seguro de UseFormProps)
export type ZodFormOptions<TSchema extends ZodTypeAny> = Pick<
  UseFormProps<output<TSchema>>,
  | "defaultValues"
  | "mode"
  | "reValidateMode"
  | "values"
  | "criteriaMode"
  | "shouldFocusError"
  | "shouldUseNativeValidation"
  | "delayError"
  | "context"
>;

// ── Overloads ────────────────────────────────────────────────────────────────
export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  defaults?: Partial<output<TSchema>>
): UseFormReturn<output<TSchema>>;
export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  options?: ZodFormOptions<TSchema>
): UseFormReturn<output<TSchema>>;

// ── Implementación ──────────────────────────────────────────────────────────
export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  optionsOrDefaults?: ZodFormOptions<TSchema> | Partial<output<TSchema>>
): UseFormReturn<output<TSchema>> {
  // Detecta si pasaron "options" completas o solo "defaults".
  const looksLikeOptions =
    optionsOrDefaults &&
    typeof optionsOrDefaults === "object" &&
    (
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "mode") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "reValidateMode") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "values") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "criteriaMode") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "shouldFocusError") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "shouldUseNativeValidation") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "delayError") ||
      Object.prototype.hasOwnProperty.call(optionsOrDefaults, "context")
    );

  const opts: ZodFormOptions<TSchema> = looksLikeOptions
    ? (optionsOrDefaults as ZodFormOptions<TSchema>)
    : { defaultValues: optionsOrDefaults as Partial<output<TSchema>> };

  return useForm<output<TSchema>>({
    // Resolver Zod. Cast para evitar discrepancias entre versiones de resolvers/RHF.
    resolver: zodResolver(schema) as any,

    // Defaults conservadores para no romper UX actual:
    // - Validación en onChange (inmediata)
    // - Revalidación en onBlur (suave)
    mode: opts.mode ?? "onChange",
    reValidateMode: opts.reValidateMode ?? "onBlur",

    // Otras opciones si vienen:
    criteriaMode: opts.criteriaMode ?? "firstError",
    shouldFocusError: opts.shouldFocusError ?? true,
    shouldUseNativeValidation: opts.shouldUseNativeValidation,
    delayError: opts.delayError,
    context: opts.context,

    // defaultValues/values adecuados
    defaultValues: opts.defaultValues as DefaultValues<output<TSchema>>,
    values: opts.values as any,
  });
}
