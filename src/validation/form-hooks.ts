import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodSchema } from "zod";

export function useZodForm<TSchema extends ZodSchema<any>>(schema: TSchema, defaultValues?: any) {
  return useForm<unknown & ReturnType<TSchema["parse"]>>({
    resolver: zodResolver(schema as any),
    defaultValues
  }) as any;
}
