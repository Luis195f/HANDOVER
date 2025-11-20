export type ErrorObject = { instancePath: string; message?: string };

type JSONSchema = {
  $ref?: string;
  const?: unknown;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  definitions?: Record<string, JSONSchema>;
};

type ValidateFn = ((data: unknown) => boolean) & { errors?: ErrorObject[] };

export default class Ajv {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts?: { allErrors?: boolean; strict?: boolean }) {}

  compile(schema: JSONSchema): ValidateFn {
    const validate: ValidateFn = (data: unknown) => {
      const errors: ErrorObject[] = [];
      const ok = validateSchema(schema, data, '', schema.definitions ?? {}, errors);
      validate.errors = ok ? undefined : errors;
      return ok;
    };
    return validate;
  }
}

function validateSchema(
  schema: JSONSchema,
  data: unknown,
  path: string,
  definitions: Record<string, JSONSchema>,
  errors: ErrorObject[],
): boolean {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, definitions);
    if (!resolved) {
      errors.push({ instancePath: path, message: `Unable to resolve ref ${schema.$ref}` });
      return false;
    }
    return validateSchema(resolved, data, path, definitions, errors);
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push({ instancePath: path, message: `must equal constant value` });
    return false;
  }

  if (schema.anyOf) {
    const anyValid = schema.anyOf.some((candidate) =>
      validateSchema(candidate, data, path, definitions, []),
    );
    if (!anyValid) {
      errors.push({ instancePath: path, message: 'must match anyOf schemas' });
      return false;
    }
  }

  if (schema.oneOf) {
    const anyValid = schema.oneOf.some((candidate) =>
      validateSchema(candidate, data, path, definitions, []),
    );
    if (!anyValid) {
      errors.push({ instancePath: path, message: 'must match one schema in oneOf' });
      return false;
    }
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(data, t))) {
      errors.push({ instancePath: path, message: `must be ${types.join(' or ')}` });
      return false;
    }
  }

  if (schema.type === 'object' && schema.properties && data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (schema.required) {
      schema.required.forEach((key) => {
        if (!(key in obj)) {
          errors.push({ instancePath: joinPath(path, key), message: "must have required property '" + key + "'" });
        }
      });
    }

    Object.entries(schema.properties).forEach(([key, propSchema]) => {
      if (key in obj) {
        validateSchema(propSchema, obj[key], joinPath(path, key), definitions, errors);
      }
    });
  }

  if (schema.type === 'array' && schema.items && Array.isArray(data)) {
    data.forEach((item, idx) => {
      validateSchema(schema.items as JSONSchema, item, joinPath(path, String(idx)), definitions, errors);
    });
  }

  return errors.length === 0;
}

function resolveRef(ref: string, definitions: Record<string, JSONSchema>): JSONSchema | undefined {
  const match = /^#\/definitions\/(.+)$/.exec(ref);
  if (!match) return undefined;
  const key = match[1];
  return definitions[key];
}

function isType(value: unknown, type: string): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value as number);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

function joinPath(base: string, segment: string): string {
  const clean = base === '' ? '' : `${base}`;
  return `${clean}/${segment}`.replace(/^\//, '/');
}
