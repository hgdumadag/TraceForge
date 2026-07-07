import { describe, it, expect } from "vitest";
import { buildEvidencePackage, stableStringify, redactText, type EvidenceInput } from "../src/index.js";

function baseInput(): EvidenceInput {
  return {
    executionId: "exec_1",
    workflowId: "wf_1",
    workflowName: "T&E Testing",
    workflowVersionId: "wfv_1",
    versionNumber: 2,
    versionStatusAtRun: "active",
    runBy: "george",
    startedAt: "2026-07-08T01:00:00.000Z",
    finishedAt: "2026-07-08T01:00:05.000Z",
    status: "succeeded",
    triggerType: "manual",
    parameterValues: { receipt_threshold: 75 },
    inputs: [{ datasetVersionId: "dsv_1", name: "expenses", sourceFileName: "expenses.csv", contentHash: "a".repeat(64), rowCount: 8 }],
    outputs: [{ datasetVersionId: "dsv_2", nodeLabel: "Validate", handle: "exceptions", contentHash: "b".repeat(64), rowCount: 3 }],
    nodeRuns: [
      { nodeId: "n1", nodeLabel: "Import", nodeType: "import_file", status: "succeeded", error: null, outputSummary: {} },
      { nodeId: "n2", nodeLabel: "Validate", nodeType: "validate", status: "succeeded", error: null, outputSummary: {} }
    ],
    logs: ["Import → output: 8 rows"],
    errorSummary: null,
    llmCalls: [],
    appVersion: "0.1.0"
  };
}

describe("evidence package", () => {
  it("is deterministic: same input, same hash and bytes", () => {
    const a = buildEvidencePackage(baseInput());
    const b = buildEvidencePackage(baseInput());
    expect(a.hash).toBe(b.hash);
    expect(a.json).toBe(b.json);
  });

  it("key order does not change the hash", () => {
    const x = stableStringify({ b: 1, a: { d: 2, c: 3 } });
    const y = stableStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(x).toBe(y);
  });

  it("different inputs produce different hashes", () => {
    const a = buildEvidencePackage(baseInput());
    const modified = baseInput();
    modified.parameterValues = { receipt_threshold: 100 };
    const b = buildEvidencePackage(modified);
    expect(a.hash).not.toBe(b.hash);
  });

  it("redacts secrets from logs and parameters", () => {
    const input = baseInput();
    input.logs = ["connecting with api_key: super_secret_value_123"];
    input.parameterValues = { api_token: "sk-abcdefghijklmnopqrstuvwx", threshold: 5 };
    const pkg = buildEvidencePackage(input);
    expect(pkg.json).not.toContain("super_secret_value_123");
    expect(pkg.json).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(pkg.json).toContain("[REDACTED]");
  });

  it("redacts secret-looking keys entirely", () => {
    const input = baseInput();
    (input.nodeRuns[0].outputSummary as any) = { password: "hunter2", rows: 10 };
    const pkg = buildEvidencePackage(input);
    expect(pkg.json).not.toContain("hunter2");
  });

  it("markdown summary contains the essentials", () => {
    const pkg = buildEvidencePackage(baseInput());
    expect(pkg.markdown).toContain("T&E Testing");
    expect(pkg.markdown).toContain("receipt_threshold");
    expect(pkg.markdown).toContain("expenses.csv");
    expect(pkg.markdown).toContain(pkg.hash);
    expect(pkg.markdown).toContain("Validate");
  });

  it("redactText leaves normal audit text alone", () => {
    const t = "Deduplicate found 1 duplicate payment over 1000 USD";
    expect(redactText(t)).toBe(t);
  });
});
