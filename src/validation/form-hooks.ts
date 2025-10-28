import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodTypeAny } from "zod";

export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  defaultValues?: unknown
): UseFormReturn<any> {
  return useForm<any>({
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues as any
  });
}
