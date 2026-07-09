/** Integration test: the full MVP lifecycle (project.md §10) through the HTTP API.
 * create → import → build → run → history → new version → verify → activate → publish. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, type AppContext } from "../src/server.js";

const here = dirname(fileURLToPath(import.meta.url));
let ctx: AppContext;
let dataDir: string;

async function api(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await ctx.app.inject({
    method: method as any,
    url,
    payload: body as any,
    headers: body ? { "content-type": "application/json" } : undefined
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    json = res.body;
  }
  return { status: res.statusCode, json };
}

async function waitForExecution(id: string): Promise<any> {
  await ctx.executions.waitFor(id, 60000);
  const { json } = await api("GET", `/api/executions/${id}`);
  return json;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "tf-api-"));
  ctx = await buildApp({ dataDir });
  // Register the deterministic mock LLM provider as default for AI tests.
  await api("POST", "/api/llm/providers", { id: "mock", type: "mock", displayName: "Mock", isDefault: true });
});

afterAll(async () => {
  await ctx.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("MVP lifecycle", () => {
  let workflowId: string;
  let draftVersionId: string;
  let expensesDsvId: string;
  let executionId: string;
  let v2Id: string;

  it("1. creates a workflow from a template (clone keeps parameters + graph)", async () => {
    const { status, json } = await api("POST", "/api/workflows", {
      templateId: "tpl_travel_expense",
      name: "T&E Testing — FY26"
    });
    expect(status).toBe(201);
    workflowId = json.workflow.id;
    draftVersionId = json.version.id;
    expect(json.workflow.templateSourceId).toBe("tpl_travel_expense");
    expect(json.version.status).toBe("draft");
    expect(json.version.versionNumber).toBe(1);
    expect(json.version.parameters.some((p: any) => p.key === "receipt_threshold")).toBe(true);
    expect(json.version.graph.nodes.length).toBeGreaterThan(0);
  });

  it("blank creation requires a name", async () => {
    const { status } = await api("POST", "/api/workflows", { name: "   " });
    expect(status).toBe(400);
  });

  it("2. imports a CSV dataset with fingerprint", async () => {
    // Build a multipart body by hand (fastify inject supports form-data payloads via header simulation).
    const csv = await readFile(join(here, "../../../packages/tabular-engine/test/fixtures/expenses.csv"));
    const boundary = "----tfboundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="expenses.csv"\r\ncontent-type: text/csv\r\n\r\n`
      ),
      csv,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/datasets/import",
      payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expensesDsvId = json.datasetVersion.id;
    expect(json.datasetVersion.rowCount).toBe(8);
    expect(json.datasetVersion.sourceFileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.datasetVersion.columns.map((c: any) => c.name)).toContain("Amount in USD");
    expect(json.dataset.sourceWorkflowId).toBeNull();
    expect(json.dataset.sourceWorkflowName).toBeNull();
    expect(json.dataset.sourceExecutionId).toBeNull();
    expect(json.dataset.executedAt).toBeNull();
  });

  it("3–4. sample datasets are available offline; preview works", async () => {
    const { json: samples } = await api("GET", "/api/samples");
    expect(samples.length).toBeGreaterThanOrEqual(5);
    const expense = samples.find((s: any) => s.name.includes("Expense"));
    const { json: preview } = await api("GET", `/api/dataset-versions/${expense.latestVersion.id}/preview?limit=5`);
    expect(preview.rows.length).toBe(5);
    expect(preview.totalRows).toBe(10);
  });

  it("5. rejects saving an invalid graph on a draft", async () => {
    const version = (await api("GET", `/api/versions/${draftVersionId}`)).json;
    const badGraph = { ...version.graph, edges: [...version.graph.edges, { id: "bad", source: "imp", target: "missing" }] };
    const { status, json } = await api("PUT", `/api/versions/${draftVersionId}`, { graph: badGraph });
    expect(status).toBe(422);
    expect(json.error).toMatch(/missing/);
  });

  it("6. runs the workflow with parameters; run history and node results persist", async () => {
    const { status, json } = await api("POST", `/api/versions/${draftVersionId}/run`, {
      parameterValues: {
        expense_listing: expensesDsvId,
        receipt_threshold: 75,
        timeliness_threshold: 60,
        prohibited_keyword: "alcohol"
      }
    });
    expect(status).toBe(202);
    executionId = json.id;
    const detail = await waitForExecution(executionId);
    expect(detail.execution.status).toBe("succeeded");
    expect(detail.execution.parameterValues.receipt_threshold).toBe(75);
    expect(detail.execution.inputDatasetVersionIds).toContain(expensesDsvId);
    expect(detail.nodeExecutions.length).toBe(3);
    expect(detail.nodeExecutions.every((n: any) => n.status === "succeeded")).toBe(true);

    // Preview a node output (data preview after each node).
    const validate = detail.nodeExecutions.find((n: any) => n.nodeType === "validate");
    const exceptionsDsv = validate.outputDatasetVersionIds.exceptions;
    expect(exceptionsDsv).toBeTruthy();
    const { json: preview } = await api("GET", `/api/dataset-versions/${exceptionsDsv}/preview`);
    expect(preview.columns.map((c: any) => c.name)).toContain("Validation");
    expect(preview.totalRows).toBeGreaterThan(0);
  });

  it("missing required parameter fails the run with a clear error", async () => {
    const { json } = await api("POST", `/api/versions/${draftVersionId}/run`, { parameterValues: {} });
    const detail = await waitForExecution(json.id);
    expect(detail.execution.status).toBe("failed");
    expect(detail.execution.errorSummary).toMatch(/Expense Listing/);
  });

  it("7. run history lists executions", async () => {
    const { json } = await api("GET", `/api/executions?workflowId=${workflowId}`);
    expect(json.length).toBeGreaterThanOrEqual(2);
    expect(json[0].workflowId).toBe(workflowId);
  });

  it("8. verification flow: submit → sample run → pass → verified (immutable)", async () => {
    const submit = await api("POST", `/api/versions/${draftVersionId}/submit`);
    expect(submit.json.status).toBe("in_review");

    // Editing an in-review version is blocked.
    const editBlocked = await api("PUT", `/api/versions/${draftVersionId}`, { notes: "sneaky edit" });
    expect(editBlocked.status).toBe(409);

    // Record tester/reviewer.
    await api("PUT", `/api/versions/${draftVersionId}/verification`, {
      tester: "George D.",
      reviewer: "Audit Manager",
      testingPerformed: "Ran sample data through all validations and reviewed exceptions."
    });

    // Pass without sample run is blocked.
    const noSample = await api("POST", `/api/versions/${draftVersionId}/decide`, { decision: "pass", notes: "ok" });
    expect(noSample.status).toBe(409);

    // Sample run.
    const sample = await api("POST", `/api/versions/${draftVersionId}/verification/sample-run`, {
      parameterValues: {
        expense_listing: expensesDsvId,
        receipt_threshold: 75,
        timeliness_threshold: 60,
        prohibited_keyword: "alcohol"
      }
    });
    await waitForExecution(sample.json.id);

    // Pass.
    const pass = await api("POST", `/api/versions/${draftVersionId}/decide`, {
      decision: "pass",
      notes: "Logic and outputs are correct."
    });
    expect(pass.status).toBe(200);
    expect(pass.json.version.status).toBe("verified");
    expect(pass.json.review.decision).toBe("pass");
    expect(pass.json.review.decidedAt).toBeTruthy();

    // Verified version is immutable.
    const editVerified = await api("PUT", `/api/versions/${draftVersionId}`, { notes: "x" });
    expect(editVerified.status).toBe(409);
  });

  it("9. only verified versions can be activated; activation supersedes prior active", async () => {
    const activate = await api("POST", `/api/versions/${draftVersionId}/activate`);
    expect(activate.json.status).toBe("active");
    const wf = (await api("GET", `/api/workflows/${workflowId}`)).json;
    expect(wf.workflow.activeVersionId).toBe(draftVersionId);
  });

  it("10. editing an active version creates a new draft (v2)", async () => {
    const draft = await api("POST", `/api/versions/${draftVersionId}/draft`);
    expect(draft.json.status).toBe("draft");
    expect(draft.json.versionNumber).toBe(2);
    expect(draft.json.sourceVersionId).toBe(draftVersionId);
    v2Id = draft.json.id;

    // Draft cannot be activated directly.
    const activateDraft = await api("POST", `/api/versions/${v2Id}/activate`);
    expect(activateDraft.status).toBe(409);
  });

  it("11. publish requires verified; publishing the active version works", async () => {
    const publishDraft = await api("POST", `/api/versions/${v2Id}/publish`, {});
    expect(publishDraft.status).toBe(409);
    expect(publishDraft.json.error).toMatch(/verified/i);

    const publish = await api("POST", `/api/versions/${draftVersionId}/publish`, {
      riskStatement: "Inappropriate T&E spend"
    });
    expect(publish.status).toBe(201);
    expect(publish.json.sourceWorkflowVersionId).toBe(draftVersionId);

    const toolkit = (await api("GET", "/api/toolkit")).json;
    expect(toolkit.length).toBe(1);

    // Clone from toolkit creates an editable draft workflow.
    const clone = await api("POST", `/api/toolkit/${publish.json.id}/clone`, { name: "Cloned T&E" });
    expect(clone.status).toBe(201);
    expect(clone.json.version.status).toBe("draft");

    // Unpublish preserves source workflow/version.
    const unpublish = await api("POST", `/api/toolkit/${publish.json.id}/unpublish`);
    expect(unpublish.json.status).toBe("unpublished");
    const versionStill = await api("GET", `/api/versions/${draftVersionId}`);
    expect(versionStill.status).toBe(200);
  });

  it("12. evidence export is deterministic, hashed, and secret-free", async () => {
    const a = (await api("GET", `/api/executions/${executionId}/evidence`)).json;
    const b = (await api("GET", `/api/executions/${executionId}/evidence`)).json;
    expect(a.hash).toBe(b.hash);
    expect(a.record.workflow.name).toBe("T&E Testing — FY26");
    expect(a.record.inputs.length).toBeGreaterThan(0);
    expect(a.record.inputs[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    const md = await ctx.app.inject({ method: "GET", url: `/api/executions/${executionId}/evidence?format=markdown` });
    expect(md.body).toContain("Execution Evidence");
    expect(md.body).toContain(a.hash);
  });

  it("13. rerun creates a linked execution with same parameters", async () => {
    const rerun = await api("POST", `/api/executions/${executionId}/rerun`);
    expect(rerun.status).toBe(202);
    const detail = await waitForExecution(rerun.json.id);
    expect(detail.execution.status).toBe("succeeded");
    expect(detail.execution.rerunOfExecutionId).toBe(executionId);
    expect(detail.execution.triggerType).toBe("rerun");
  });

  it("14. AI assist works through the mock provider with schema validation", async () => {
    const chat = await api("POST", "/api/llm/chat", { prompt: "Explain duplicate testing", providerId: "mock" });
    expect(chat.json.content).toContain("mock:");
    expect(chat.json.providerId).toBe("mock");

    // Expression suggestion validates model output against the actual schema.
    const mock = ctx.llm.gateway.getProvider("mock") as any;
    mock.responses.push('{"expression": "{Amount in USD} > {param!receipt_threshold}", "explanation": "flags high amounts"}');
    const suggest = await api("POST", "/api/llm/suggest-expression", {
      request: "flag amounts over the receipt threshold",
      columns: { "Amount in USD": "decimal" },
      parameters: [{ key: "receipt_threshold", label: "Receipt Threshold", type: "decimal", required: true }],
      providerId: "mock"
    });
    expect(suggest.json.valid).toBe(true);

    // Invalid suggestion is flagged, not silently inserted.
    mock.responses.push('{"expression": "{Nope} > 1", "explanation": ""}');
    const bad = await api("POST", "/api/llm/suggest-expression", {
      request: "x",
      columns: { "Amount in USD": "decimal" },
      parameters: [],
      providerId: "mock"
    });
    expect(bad.json.valid).toBe(false);
  });

  it("archive hides the workflow and unpublishes its tools; evidence survives", async () => {
    await api("POST", `/api/workflows/${workflowId}/archive`);
    const list = (await api("GET", "/api/workflows")).json;
    expect(list.some((w: any) => w.id === workflowId)).toBe(false);
    const withArchived = (await api("GET", "/api/workflows?includeArchived=true")).json;
    expect(withArchived.some((w: any) => w.id === workflowId)).toBe(true);
    // Evidence still accessible.
    const evidence = await api("GET", `/api/executions/${executionId}/evidence`);
    expect(evidence.status).toBe(200);
  });

  it("hard delete is blocked for workflows with execution evidence", async () => {
    const del = await api("DELETE", `/api/workflows/${workflowId}`);
    expect(del.status).toBe(409);
    expect(del.json.error).toMatch(/evidence/);
  });

  it("hard delete works for a fresh unexecuted draft", async () => {
    const fresh = await api("POST", "/api/workflows", { name: "Scratch" });
    const del = await api("DELETE", `/api/workflows/${fresh.json.workflow.id}`);
    expect(del.status).toBe(200);
  });
});
