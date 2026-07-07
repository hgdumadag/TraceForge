import { z } from "zod";

/** Workflow parameter types (features/parameters.md §2). */
export const PARAMETER_TYPES = [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "enum",
  "dataset"
] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];

export const PARAMETER_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

export const ParameterDefinitionSchema = z
  .object({
    key: z.string().regex(PARAMETER_KEY_REGEX, {
      message:
        "Parameter key must use lowercase letters, numbers, and underscores, and start with a letter."
    }),
    label: z.string().min(1, { message: "Parameter label cannot be blank." }),
    type: z.enum(PARAMETER_TYPES),
    required: z.boolean().default(false),
    description: z.string().optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    /** Required for `enum` parameters. */
    allowedValues: z.array(z.string()).optional()
  })
  .superRefine((def, ctx) => {
    if (def.type === "enum" && (!def.allowedValues || def.allowedValues.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Enum parameter "${def.key}" must define allowed values.`
      });
    }
    if (def.defaultValue !== undefined && def.defaultValue !== null) {
      const err = checkParameterValue(def as ParameterDefinition, def.defaultValue);
      if (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Default value for "${def.key}" is invalid: ${err}`
        });
      }
    }
  });

export type ParameterDefinition = z.infer<typeof ParameterDefinitionSchema>;

export const ParameterDefinitionListSchema = z
  .array(ParameterDefinitionSchema)
  .superRefine((defs, ctx) => {
    const seen = new Set<string>();
    for (const d of defs) {
      if (seen.has(d.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate parameter key "${d.key}".`
        });
      }
      seen.add(d.key);
    }
  });

export type ParameterValue = string | number | boolean | null;
export type ParameterValues = Record<string, ParameterValue>;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Returns an error message, or null when the value matches the declared type. */
export function checkParameterValue(
  def: Pick<ParameterDefinition, "key" | "type" | "allowedValues">,
  value: ParameterValue
): string | null {
  if (value === null) return null;
  switch (def.type) {
    case "text":
      return typeof value === "string" ? null : "expected text";
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : "expected an integer";
    case "decimal":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : "expected a number";
    case "boolean":
      return typeof value === "boolean" ? null : "expected true or false";
    case "date":
      return typeof value === "string" && DATE_REGEX.test(value)
        ? null
        : "expected a date in YYYY-MM-DD format";
    case "enum":
      if (typeof value !== "string") return "expected one of the allowed values";
      return def.allowedValues?.includes(value)
        ? null
        : `expected one of: ${def.allowedValues?.join(", ")}`;
    case "dataset":
      // Dataset parameters bind to a dataset version id (string reference).
      return typeof value === "string" && value.length > 0
        ? null
        : "expected a dataset reference";
  }
}

export interface ParameterResolution {
  ok: boolean;
  values: ParameterValues;
  errors: string[];
}

/**
 * Deterministically resolve runtime parameter values against definitions.
 * Runtime overrides win over defaults. Required parameters without a value block the run.
 */
export function resolveParameters(
  defs: ParameterDefinition[],
  runtimeValues: ParameterValues
): ParameterResolution {
  const errors: string[] = [];
  const values: ParameterValues = {};

  for (const key of Object.keys(runtimeValues)) {
    if (!defs.some((d) => d.key === key)) {
      errors.push(`Unknown parameter "${key}" was supplied.`);
    }
  }

  for (const def of defs) {
    const supplied = runtimeValues[def.key];
    const value = supplied !== undefined ? supplied : def.defaultValue ?? null;
    if ((value === null || value === undefined) && def.required) {
      errors.push(`Required parameter "${def.label}" (${def.key}) is missing a value.`);
      continue;
    }
    if (value !== null && value !== undefined) {
      const err = checkParameterValue(def, value);
      if (err) {
        errors.push(`Parameter "${def.label}" (${def.key}): ${err}.`);
        continue;
      }
    }
    values[def.key] = value ?? null;
  }

  return { ok: errors.length === 0, values, errors };
}
