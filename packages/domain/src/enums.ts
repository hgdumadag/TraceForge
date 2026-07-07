/**
 * Canonical status enums.
 *
 * Note: project.md lists `ready_for_review`; features/versioning.md calls the same
 * state "In Review". The canonical machine value is `in_review` (see ADR-013).
 */

export const VERSION_STATUSES = [
  "draft",
  "in_review",
  "verified",
  "rejected",
  "active",
  "superseded",
  "archived"
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const EXECUTION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "suspended"
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const NODE_EXECUTION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled"
] as const;
export type NodeExecutionStatus = (typeof NODE_EXECUTION_STATUSES)[number];

export const WORKFLOW_STATUSES = ["active", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const COLUMN_TYPES = [
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "unknown"
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const VERIFICATION_DECISIONS = ["pass", "fail", "amend"] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

export const PUBLISHED_TOOL_STATUSES = ["published", "unpublished", "deprecated"] as const;
export type PublishedToolStatus = (typeof PUBLISHED_TOOL_STATUSES)[number];

export const LLM_PROVIDER_TYPES = ["ollama", "openai", "azure_foundry", "mock"] as const;
export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number];

/** Allowed workflow-version status transitions (features/versioning.md §4). */
const VERSION_TRANSITIONS: Record<VersionStatus, VersionStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["verified", "rejected", "draft"],
  verified: ["active", "archived"],
  rejected: ["draft", "archived"],
  active: ["superseded", "archived"],
  superseded: ["archived", "active"],
  archived: []
};

export function canTransitionVersion(from: VersionStatus, to: VersionStatus): boolean {
  return VERSION_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Only drafts are editable. Executed/verified/active versions are immutable (ADR-011). */
export function isVersionEditable(status: VersionStatus): boolean {
  return status === "draft";
}

export function isVersionImmutable(status: VersionStatus): boolean {
  return !isVersionEditable(status);
}
