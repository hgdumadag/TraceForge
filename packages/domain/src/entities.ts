/** Core domain entities (project.md §7). */
import { z } from "zod";
import {
  VERSION_STATUSES,
  EXECUTION_STATUSES,
  NODE_EXECUTION_STATUSES,
  WORKFLOW_STATUSES,
  VERIFICATION_DECISIONS,
  PUBLISHED_TOOL_STATUSES,
  COLUMN_TYPES
} from "./enums.js";
import { WorkflowGraphSchema } from "./graph.js";
import { ParameterDefinitionListSchema } from "./parameters.js";

export const WorkflowSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string().min(1, { message: "Name cannot be blank." }).max(150),
  description: z.string().default(""),
  category: z.string().default(""),
  serviceTags: z.array(z.string()).default([]),
  type: z.string().default("Audit"),
  owner: z.string().default(""),
  status: z.enum(WORKFLOW_STATUSES).default("active"),
  activeVersionId: z.string().nullable().default(null),
  templateSourceId: z.string().nullable().default(null),
  templateSourceVersion: z.number().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null)
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowVersionSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  versionNumber: z.number().int().positive(),
  status: z.enum(VERSION_STATUSES),
  sourceVersionId: z.string().nullable().default(null),
  graph: WorkflowGraphSchema,
  parameters: ParameterDefinitionListSchema,
  notes: z.string().default(""),
  businessCase: z.string().default(""),
  requirementsAndDesignConsiderations: z.string().default(""),
  estimatedCostSavingsPerRun: z.number().nullable().default(null),
  estimatedTimeSavingsPerRun: z.number().nullable().default(null),
  createdBy: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedBy: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null)
});
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

export const DatasetColumnSchema = z.object({
  name: z.string(),
  type: z.enum(COLUMN_TYPES)
});
export type DatasetColumn = z.infer<typeof DatasetColumnSchema>;

export const DatasetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string().min(1),
  kind: z.enum(["imported_file", "sample", "manual_table", "node_output", "api_import"]),
  createdAt: z.string(),
  sourceWorkflowId: z.string().nullable().default(null),
  sourceWorkflowName: z.string().nullable().default(null),
  sourceExecutionId: z.string().nullable().default(null),
  executedAt: z.string().nullable().default(null)
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const DatasetVersionSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  /** Storage path relative to the workspace data directory (Parquet file). */
  storagePath: z.string(),
  /** SHA-256 of the stored content. */
  contentHash: z.string(),
  /** Fingerprint of the original source file where applicable. */
  sourceFileName: z.string().nullable().default(null),
  sourceFileHash: z.string().nullable().default(null),
  sourceFileSize: z.number().nullable().default(null),
  rowCount: z.number().int().nonnegative(),
  columns: z.array(DatasetColumnSchema),
  createdAt: z.string(),
  /** Immutable once referenced by an execution. */
  locked: z.boolean().default(false)
});
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;

export const ExecutionSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowVersionId: z.string(),
  versionStatusAtRun: z.enum(VERSION_STATUSES),
  status: z.enum(EXECUTION_STATUSES),
  triggerType: z.enum(["manual", "verification_sample", "rerun"]).default("manual"),
  rerunOfExecutionId: z.string().nullable().default(null),
  parameterValues: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  inputDatasetVersionIds: z.array(z.string()).default([]),
  outputDatasetVersionIds: z.array(z.string()).default([]),
  errorSummary: z.string().nullable().default(null),
  createdBy: z.string().default(""),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  createdAt: z.string()
});
export type Execution = z.infer<typeof ExecutionSchema>;

export const NodeExecutionSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  nodeId: z.string(),
  nodeType: z.string(),
  nodeLabel: z.string().default(""),
  status: z.enum(NODE_EXECUTION_STATUSES),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  inputSummary: z.record(z.unknown()).default({}),
  outputSummary: z.record(z.unknown()).default({}),
  /** Output handle name -> dataset version id. */
  outputDatasetVersionIds: z.record(z.string()).default({}),
  error: z.string().nullable().default(null),
  logs: z.array(z.string()).default([])
});
export type NodeExecution = z.infer<typeof NodeExecutionSchema>;

export const VerificationReviewSchema = z.object({
  id: z.string(),
  workflowVersionId: z.string(),
  tester: z.string().default(""),
  reviewer: z.string().default(""),
  testingPerformed: z.string().default(""),
  sampleExecutionId: z.string().nullable().default(null),
  decision: z.enum(VERIFICATION_DECISIONS).nullable().default(null),
  decisionNotes: z.string().default(""),
  amendComments: z.string().default(""),
  createdAt: z.string(),
  decidedAt: z.string().nullable().default(null)
});
export type VerificationReview = z.infer<typeof VerificationReviewSchema>;

export const PublishedToolSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  category: z.string().default(""),
  description: z.string().default(""),
  riskStatement: z.string().default(""),
  sourceWorkflowId: z.string(),
  sourceWorkflowVersionId: z.string(),
  status: z.enum(PUBLISHED_TOOL_STATUSES).default("published"),
  publishedBy: z.string().default(""),
  publishedAt: z.string(),
  unpublishedAt: z.string().nullable().default(null)
});
export type PublishedTool = z.infer<typeof PublishedToolSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  riskStatement: z.string().default(""),
  requiredInputs: z.array(z.object({
    name: z.string(),
    description: z.string().default("")
  })).default([]),
  parameters: ParameterDefinitionListSchema.default([]),
  graph: WorkflowGraphSchema,
  expectedOutputs: z.array(z.string()).default([]),
  containsCustomCode: z.boolean().default(false),
  requiresCredential: z.boolean().default(false),
  /** Sample dataset ids that satisfy requiredInputs for local testing. */
  sampleDatasetIds: z.array(z.string()).default([]),
  builtIn: z.boolean().default(false)
});
export type Template = z.infer<typeof TemplateSchema>;
