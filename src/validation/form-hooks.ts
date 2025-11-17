import { useForm, type DefaultValues, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodTypeAny, z } from "zod";

export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  defaultValues?: DefaultValues<z.infer<TSchema>>
): UseFormReturn<z.infer<TSchema>> {
  return useForm<z.infer<TSchema>>({
    resolver: zodResolver(schema as any),
    defaultValues
  });
}
