import { useForm, type UseFormReturn, type DefaultValues, type FieldValues } from 'react-hook-form';
import { z, type ZodTypeAny } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

type FormValues<TSchema extends ZodTypeAny> = z.output<TSchema> & FieldValues;

type ZodFormOptions<TSchema extends ZodTypeAny> = {
  defaultValues?: DefaultValues<FormValues<TSchema>>;
};

export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  options?: ZodFormOptions<TSchema>,
): UseFormReturn<FormValues<TSchema>> {
  const resolver = zodResolver(schema as any) as any;
  return useForm<FormValues<TSchema>>({
    resolver,
    defaultValues: options?.defaultValues,
  });
}
