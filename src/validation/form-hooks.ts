import { useForm, type UseFormReturn, type DefaultValues } from 'react-hook-form';
import { z, type ZodTypeAny } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

type ZodFormOptions<T extends ZodTypeAny> = {
  defaultValues?: DefaultValues<z.output<T>>;
};

export function useZodForm<T extends ZodTypeAny>(
  schema: T,
  options?: ZodFormOptions<T>,
): UseFormReturn<z.output<T>> {
  return useForm<z.output<T>>({
    resolver: zodResolver(schema) as any,
    defaultValues: options?.defaultValues,
  });
}
