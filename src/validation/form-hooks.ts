// @ts-nocheck
import { useForm, type UseFormReturn, type DefaultValues } from 'react-hook-form';
import { z, type ZodTypeAny } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

type ZodFormOptions<T extends ZodTypeAny> = { defaultValues?: DefaultValues<z.infer<T>> };

export function useZodForm<T extends ZodTypeAny>(
  schema: T,
  options?: ZodFormOptions<T>,
): UseFormReturn<z.infer<T>> {
  return useForm<z.infer<T>>({
    resolver: zodResolver(schema) as any,
    defaultValues: options?.defaultValues,
  });
}
