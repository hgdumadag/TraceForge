/**
 * Evidence generation (project.md §6.8). Deterministic, testable, and
 * secret-free: given the same execution facts, the same evidence bytes and
 * hash are produced.
 */
import { createHash } from "node:crypto";

export interface EvidenceInput {
  executionId: string;
  workflowId: string;
  workflowName: string;
  workflowVersionId: string;
  versionNumber: number;
  versionStatusAtRun: string;
  runBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  triggerType: string;
  parameterValues: Record<string, unknown>;
  inputs: { datasetVersionId: string; name: string; sourceFileName: string | null; contentHash: string; rowCount: number }[];
  outputs: { datasetVersionId: string; nodeLabel: string; handle: string; contentHash: string; rowCount: number }[];
  nodeRuns: { nodeId: string; nodeLabel: string; nodeType: string; status: string; error: string | null; outputSummary: Record<string, unknown> }[];
  logs: string[];
  errorSummary: string | null;
  llmCalls: { providerId: string; providerType: string; model: string; latencyMs: number; at: string }[];
  appVersion: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /(api[-_ ]?key|secret|token|password|bearer|credential)\s*[:=]\s*\S+/gi,
  /sk-[A-Za-z0-9]{16,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
];

export function redactText(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out;
}

function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /password|secret|token|api[-_]?key|credential/i.test(k) ? "[REDACTED]" : redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Deterministic JSON: object keys sorted recursively, no whitespace variance. */
export function stableStringify(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out: Record<string, unknown> = {};
      for (const [k, val] of entries) out[k] = normalize(val);
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value), null, 2);
}

export interface EvidencePackage {
  /** The evidence record itself (JSON-serializable, secret-free). */
  record: Record<string, unknown>;
  /** SHA-256 of the serialized record. */
  hash: string;
  /** Serialized JSON bytes (what the hash covers). */
  json: string;
  /** Human-readable markdown summary for auditors. */
  markdown: string;
}

export function buildEvidencePackage(input: EvidenceInput): EvidencePackage {
  const record = redactDeep({
    evidenceVersion: 1,
    execution: {
      id: input.executionId,
      status: input.status,
      triggerType: input.triggerType,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      runBy: input.runBy,
      errorSummary: input.errorSummary
    },
    workflow: {
      id: input.workflowId,
      name: input.workflowName,
      versionId: input.workflowVersionId,
      versionNumber: input.versionNumber,
      versionStatusAtRun: input.versionStatusAtRun
    },
    parameters: input.parameterValues,
    inputs: input.inputs,
    outputs: input.outputs,
    nodeRuns: input.nodeRuns,
    logs: input.logs,
    llmCalls: input.llmCalls,
    app: { name: "TraceForge", version: input.appVersion }
  }) as Record<string, unknown>;

  const json = stableStringify(record);
  const hash = createHash("sha256").update(json).digest("hex");

  const md: string[] = [];
  md.push(`# Execution Evidence — ${input.workflowName}`);
  md.push("");
  md.push(`| Field | Value |`);
  md.push(`|---|---|`);
  md.push(`| Execution ID | ${input.executionId} |`);
  md.push(`| Workflow | ${input.workflowName} (${input.workflowId}) |`);
  md.push(`| Version | v${input.versionNumber} (${input.workflowVersionId}), status at run: ${input.versionStatusAtRun} |`);
  md.push(`| Status | ${input.status} |`);
  md.push(`| Run by | ${input.runBy || "local user"} |`);
  md.push(`| Started | ${input.startedAt ?? "-"} |`);
  md.push(`| Finished | ${input.finishedAt ?? "-"} |`);
  md.push(`| Evidence hash | \`${hash}\` |`);
  md.push("");
  md.push(`## Parameters`);
  md.push("");
  const paramEntries = Object.entries(input.parameterValues);
  if (paramEntries.length === 0) md.push("_None_");
  else {
    md.push(`| Parameter | Value |`, `|---|---|`);
    for (const [k, v] of paramEntries) md.push(`| ${k} | ${redactText(String(v))} |`);
  }
  md.push("", `## Input datasets`, "");
  if (input.inputs.length === 0) md.push("_None_");
  else {
    md.push(`| Dataset | Source file | Rows | SHA-256 |`, `|---|---|---:|---|`);
    for (const i of input.inputs) md.push(`| ${i.name} | ${i.sourceFileName ?? "-"} | ${i.rowCount} | \`${i.contentHash.slice(0, 16)}…\` |`);
  }
  md.push("", `## Output datasets`, "");
  if (input.outputs.length === 0) md.push("_None_");
  else {
    md.push(`| Node | Output | Rows | SHA-256 |`, `|---|---|---:|---|`);
    for (const o of input.outputs) md.push(`| ${o.nodeLabel} | ${o.handle} | ${o.rowCount} | \`${o.contentHash.slice(0, 16)}…\` |`);
  }
  md.push("", `## Node results`, "");
  md.push(`| Node | Type | Status | Error |`, `|---|---|---|---|`);
  for (const n of input.nodeRuns) md.push(`| ${n.nodeLabel} | ${n.nodeType} | ${n.status} | ${n.error ? redactText(n.error) : "-"} |`);
  if (input.llmCalls.length > 0) {
    md.push("", `## LLM usage`, "");
    md.push(`| Provider | Model | Latency |`, `|---|---|---|`);
    for (const c of input.llmCalls) md.push(`| ${c.providerType} (${c.providerId}) | ${c.model} | ${c.latencyMs}ms |`);
  }

  return { record, hash, json, markdown: md.join("\n") };
}
