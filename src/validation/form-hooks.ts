import { useForm, type UseFormReturn, type DefaultValues, type FieldValues } from 'react-hook-form';
import { z, type ZodTypeAny } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

type InferFieldValues<TSchema extends ZodTypeAny> = z.infer<TSchema> & FieldValues;

type ZodFormOptions<TSchema extends ZodTypeAny> = {
  defaultValues?: DefaultValues<InferFieldValues<TSchema>>;
};

export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  options?: ZodFormOptions<TSchema>,
): UseFormReturn<InferFieldValues<TSchema>> {
  const resolver = zodResolver(schema as any) as any;
  return useForm<InferFieldValues<TSchema>>({
    resolver,
    defaultValues: options?.defaultValues,
  });
}
