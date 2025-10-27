import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType } from "zod";

export function useZodForm<TSchema extends ZodType<any, any, any>>(schema: TSchema, defaultValues?: any) {
  return useForm<any>({
    resolver: zodResolver(schema as any),
    defaultValues,
  }) as any;
}
