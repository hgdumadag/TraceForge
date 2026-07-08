/**
 * Node type registry (features/node-configuration.md).
 * Every node type declares inputs, outputs, and a zod config schema.
 * Node config UI and the execution engine are both driven from this registry.
 */
import { z } from "zod";
import { COLUMN_TYPES } from "./enums.js";

const columnType = z.enum(COLUMN_TYPES);

export interface NodePort {
  name: string;
  /** Required inputs must have an incoming edge before run. */
  required?: boolean;
  /** true when multiple incoming edges are allowed on this input. */
  multi?: boolean;
}

export interface NodeTypeDef {
  type: string;
  label: string;
  category: "Import" | "Clean" | "Merge" | "Transform" | "Code" | "Visualize" | "Governance" | "AI";
  description: string;
  inputs: NodePort[];
  outputs: NodePort[];
  configSchema: z.ZodTypeAny;
  /** Node needs network access (shown in UI, blocked offline with a clear error). */
  requiresNetwork?: boolean;
  /** Node executes untrusted custom code in an isolated process. */
  customCode?: boolean;
}

const exprString = z.string().min(1, { message: "Expression is required." });

// --- Import ---------------------------------------------------------------

const importFileConfig = z.object({
  /** Bind to a fixed dataset version, or to a dataset-type workflow parameter. */
  datasetVersionId: z.string().optional(),
  datasetParameterKey: z.string().optional()
}).refine((c) => !!c.datasetVersionId || !!c.datasetParameterKey, {
  message: "Import File must reference an imported dataset or a dataset parameter."
});

const importApiConfig = z.object({
  url: z.string().url({ message: "A valid URL is required." }),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  /** Credential reference id — never a raw secret (project.md §8.4). */
  credentialId: z.string().optional(),
  /** JSON path to the array of records, e.g. "data.items". */
  recordsPath: z.string().optional()
});

const importSampleConfig = z.object({
  sampleId: z.string().min(1, { message: "Choose a sample dataset." })
});

const newTableConfig = z.object({
  columns: z.array(z.object({ name: z.string().min(1), type: columnType })).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
});

// --- Clean ----------------------------------------------------------------

const findReplaceConfig = z.object({
  column: z.string().min(1),
  find: z.string(),
  replace: z.string(),
  matchCase: z.boolean().default(false)
});

const textToColumnsConfig = z.object({
  column: z.string().min(1),
  delimiter: z.string().min(1),
  newColumns: z.array(z.string().min(1)).min(1)
});

const parseJsonConfig = z.object({
  column: z.string().min(1),
  fields: z.array(z.object({
    path: z.string().min(1),
    name: z.string().min(1)
  })).min(1)
});

const sampleConfig = z.object({
  mode: z.enum(["first", "random"]).default("first"),
  rows: z.number().int().positive()
});

const validateConfig = z.object({
  rules: z.array(z.object({
    name: z.string().min(1, { message: "Validation name is required." }),
    /** Rows where the condition is TRUE are exceptions. */
    condition: exprString,
    severity: z.enum(["low", "medium", "high"]).default("medium")
  })).min(1),
  /** Columns to include in the exceptions output; empty = all. */
  outputColumns: z.array(z.string()).optional()
});

// --- Merge ----------------------------------------------------------------

const joinConfig = z.object({
  joinType: z.enum(["inner", "left", "full"]).default("inner"),
  keys: z.array(z.object({ left: z.string().min(1), right: z.string().min(1) })).min(1, {
    message: "Join requires at least one key pair."
  }),
  /** Suffix applied to right-side columns on name collisions. */
  rightSuffix: z.string().default("_right")
});

const appendConfig = z.object({
  alignByName: z.boolean().default(true)
});

// --- Transform --------------------------------------------------------------

const addColumnsConfig = z.object({
  columns: z.array(z.object({
    name: z.string().min(1, { message: "Column name is required." }),
    expression: exprString
  })).min(1)
});

const editColumnsConfig = z.object({
  edits: z.array(z.object({
    column: z.string().min(1),
    rename: z.string().optional(),
    newType: columnType.optional(),
    /** strptime format for text → date/datetime conversions, e.g. "%Y%m%d" for 20260730. */
    sourceFormat: z.string().optional()
  })).min(1)
});

const overwriteColumnsConfig = z.object({
  columns: z.array(z.object({
    name: z.string().min(1),
    expression: exprString
  })).min(1)
});

const selectColumnsConfig = z.object({
  columns: z.array(z.string().min(1)).min(1, { message: "Select at least one column." })
});

const filterConfig = z.object({
  expression: exprString,
  limit: z.number().int().positive().optional(),
  emitNonMatching: z.boolean().default(false)
});

const sortConfig = z.object({
  keys: z.array(z.object({
    column: z.string().min(1),
    direction: z.enum(["asc", "desc"]).default("asc")
  })).min(1)
});

const deduplicateConfig = z.object({
  keys: z.array(z.string().min(1)).min(1, { message: "Choose at least one key column." }),
  keep: z.enum(["first", "last", "sort"]).default("first"),
  sortColumn: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc")
}).refine((c) => c.keep !== "sort" || !!c.sortColumn, {
  message: "Keep-by-sort requires a sort column."
});

const pivotConfig = z.object({
  groupBy: z.array(z.string().min(1)).min(1),
  pivotColumn: z.string().min(1),
  valueColumn: z.string().min(1),
  aggregate: z.enum(["sum", "count", "min", "max", "avg"]).default("sum")
});

const unpivotConfig = z.object({
  idColumns: z.array(z.string().min(1)).min(1),
  valueColumns: z.array(z.string().min(1)).min(1),
  nameTo: z.string().default("name"),
  valueTo: z.string().default("value")
});

// --- Code / Visualize / Governance / AI -------------------------------------

const pythonConfig = z.object({
  code: z.string().min(1, { message: "Python code is required." }),
  timeoutMs: z.number().int().positive().max(300000).default(60000)
});

const chartConfig = z.object({
  chartType: z.enum(["bar", "line", "pie"]).default("bar"),
  dimension: z.string().min(1),
  measure: z.string().min(1),
  aggregate: z.enum(["sum", "count", "min", "max", "avg"]).default("sum")
});

const publishToolkitConfig = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  description: z.string().optional()
});

const llmChatConfig = z.object({
  prompt: z.string().min(1, { message: "Prompt is required." }),
  /** Provider config id; default provider (Ollama) is used when omitted. */
  providerId: z.string().optional(),
  /** Explicit opt-in before any data schema is shared. Raw rows are never sent. */
  includeSchema: z.boolean().default(false)
});

const explainExpressionConfig = z.object({
  expression: exprString,
  providerId: z.string().optional()
});

const generateTestLogicConfig = z.object({
  objective: z.string().min(1, { message: "Describe the audit objective." }),
  providerId: z.string().optional()
});

// ----------------------------------------------------------------------------

const dataset = (name: string, required = true, multi = false): NodePort => ({ name, required, multi });

export const NODE_TYPES: NodeTypeDef[] = [
  // Import
  { type: "import_file", label: "Import File", category: "Import", description: "Load an imported CSV/Excel/JSON/Parquet dataset or a dataset parameter.", inputs: [], outputs: [dataset("output")], configSchema: importFileConfig },
  { type: "import_api", label: "Import from API", category: "Import", description: "Fetch records from an HTTP API (requires network).", inputs: [], outputs: [dataset("output")], configSchema: importApiConfig, requiresNetwork: true },
  { type: "import_sample", label: "Import Sample Data", category: "Import", description: "Use a built-in sample dataset (works offline).", inputs: [], outputs: [dataset("output")], configSchema: importSampleConfig },
  { type: "new_table", label: "New Table", category: "Import", description: "Define a small local table by hand.", inputs: [], outputs: [dataset("output")], configSchema: newTableConfig },
  // Clean
  { type: "find_replace", label: "Find Replace", category: "Clean", description: "Find and replace text in a column.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: findReplaceConfig },
  { type: "text_to_columns", label: "Text to Columns", category: "Clean", description: "Split a text column by a delimiter.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: textToColumnsConfig },
  { type: "parse_json", label: "Parse JSON", category: "Clean", description: "Extract fields from a JSON text column.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: parseJsonConfig },
  { type: "sample", label: "Sample", category: "Clean", description: "Take the first N or a random sample of rows.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: sampleConfig },
  { type: "validate", label: "Validate", category: "Clean", description: "Apply audit validation rules; exceptions flow to the exceptions output.", inputs: [dataset("input")], outputs: [dataset("exceptions"), dataset("summary")], configSchema: validateConfig },
  // Merge
  { type: "join", label: "Join", category: "Merge", description: "Join two datasets on key columns.", inputs: [dataset("left"), dataset("right")], outputs: [dataset("output")], configSchema: joinConfig },
  { type: "append", label: "Append", category: "Merge", description: "Stack rows from multiple compatible datasets.", inputs: [dataset("input", true, true)], outputs: [dataset("output")], configSchema: appendConfig },
  // Transform
  { type: "add_columns", label: "Add Columns", category: "Transform", description: "Add calculated columns.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: addColumnsConfig },
  { type: "edit_columns", label: "Edit Columns", category: "Transform", description: "Rename columns or change types.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: editColumnsConfig },
  { type: "overwrite_columns", label: "Overwrite Columns", category: "Transform", description: "Replace values in existing columns using expressions.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: overwriteColumnsConfig },
  { type: "select_columns", label: "Select Columns", category: "Transform", description: "Choose a subset and order of columns.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: selectColumnsConfig },
  { type: "filter", label: "Filter", category: "Transform", description: "Keep rows matching an expression.", inputs: [dataset("input")], outputs: [dataset("matched"), dataset("unmatched")], configSchema: filterConfig },
  { type: "sort", label: "Sort", category: "Transform", description: "Sort rows.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: sortConfig },
  { type: "deduplicate", label: "Deduplicate", category: "Transform", description: "Remove duplicate rows by key columns; duplicates flow to a second output.", inputs: [dataset("input")], outputs: [dataset("unique"), dataset("duplicates")], configSchema: deduplicateConfig },
  { type: "pivot", label: "Pivot", category: "Transform", description: "Pivot values into columns.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: pivotConfig },
  { type: "unpivot", label: "Unpivot", category: "Transform", description: "Unpivot columns into rows.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: unpivotConfig },
  // Code
  { type: "python", label: "Python", category: "Code", description: "Run Python on the input dataset in an isolated process.", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: pythonConfig, customCode: true },
  // Visualize
  { type: "chart", label: "Chart", category: "Visualize", description: "Aggregate and chart a measure by a dimension (local preview).", inputs: [dataset("input")], outputs: [dataset("output")], configSchema: chartConfig },
  // Governance
  { type: "publish_toolkit", label: "Publish to Toolkit", category: "Governance", description: "Marks the terminal output for toolkit publishing (verified versions only).", inputs: [dataset("input")], outputs: [], configSchema: publishToolkitConfig },
  // AI
  { type: "llm_chat", label: "LLM Chat", category: "AI", description: "Ask the configured LLM provider a question. Ollama (local) by default.", inputs: [dataset("input", false)], outputs: [dataset("output")], configSchema: llmChatConfig },
  { type: "explain_expression", label: "Explain Expression", category: "AI", description: "Ask the LLM to explain an expression in plain language.", inputs: [], outputs: [dataset("output")], configSchema: explainExpressionConfig },
  { type: "generate_test_logic", label: "Generate Test Logic", category: "AI", description: "Draft audit test logic from an objective (review before use).", inputs: [], outputs: [dataset("output")], configSchema: generateTestLogicConfig }
];

const registry = new Map(NODE_TYPES.map((n) => [n.type, n]));

export function getNodeType(type: string): NodeTypeDef | undefined {
  return registry.get(type);
}

export interface NodeConfigValidation {
  ok: boolean;
  errors: string[];
  config?: unknown;
}

/** Validate (and normalize, applying defaults) a node's config against its schema. */
export function validateNodeConfig(type: string, config: unknown): NodeConfigValidation {
  const def = registry.get(type);
  if (!def) return { ok: false, errors: [`Unknown node type "${type}".`] };
  const result = def.configSchema.safeParse(config ?? {});
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${def.label}: ${i.path.length ? i.path.join(".") + " — " : ""}${i.message}`)
    };
  }
  return { ok: true, errors: [], config: result.data };
}
