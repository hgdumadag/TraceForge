# Workflow Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow version be exported to a portable JSON file from the canvas toolbar, and let that file be imported back in from the Catalog page as a brand-new draft workflow — implementing `docs/superpowers/specs/2026-07-09-workflow-import-export-design.md`.

**Architecture:** Export is client-side only — the version editor already holds everything it needs (workflow metadata + the in-memory graph) to assemble a versioned JSON envelope and trigger a browser download; no backend change. Import needs one new backend endpoint, `POST /api/workflows/import`, because only the server writes to SQLite: it validates the envelope shape with a new shared Zod schema, runs the embedded graph through the existing `validateGraph()`, then persists atomically (wrapped in `BEGIN`/`COMMIT`/`ROLLBACK`, the same pattern already used by the migration runner in `apps/api/src/db.ts`) by reusing the existing `Store.createWorkflow()` insert logic — nothing is written unless every check passes.

**Tech Stack:** TypeScript, Zod (`packages/domain`), Fastify (`apps/api`), `node:sqlite` `DatabaseSync`, React 18 (`apps/web`), Vitest.

## Global Constraints

- Node ≥ 20; npm workspaces monorepo. Never edit files under `node_modules/`.
- `packages/domain` compiles to `dist/`, and `apps/api`/`apps/web` resolve `@traceforge/domain` through that compiled output (not source) — **after any change under `packages/domain/src`, run `npm run build -w @traceforge/domain` before building or testing anything that imports it**, or the consuming workspace will see stale types/exports.
- Full build order (matches root `build` script): `npm run build -w @traceforge/domain` → `npm run build -w @traceforge/api` → `npm run build -w @traceforge/web`. Root shortcut: `npm run build`.
- Test command: `npx vitest run <path>` for a single file during a task; `npm run test` (root `vitest run`) runs the full suite (`packages/*/test/**/*.test.ts` + `apps/api/test/**/*.test.ts` per `vitest.config.ts`). The web app has no unit-test runner — its verification is `npm run build -w @traceforge/web` (typecheck) plus the manual smoke test in Task 5.
- Do not modify `e2e/mvp-lifecycle.spec.ts` or `e2e/zz-chart.spec.ts` — existing specs must keep passing unmodified. This plan does not add new E2E specs (per the spec doc's testing section — manual smoke test is sufficient here).
- Preserve the existing toolbar buttons' accessible names verbatim (`Save changes`, `Validate`, `▶ Run`, `Run workflow`) — they're load-bearing for the existing E2E suite. New buttons (`Export`, `Import`) are additive, placed alongside, not replacing anything.
- Every commit message: single imperative line, then trailer, e.g. `git commit -m "feat: ..." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`.

---

## Task 1: Shared export envelope schema (`@traceforge/domain`)

**Files:**
- Create: `packages/domain/src/workflowExport.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/workflowExport.test.ts`

**Interfaces:**
- Produces: `WORKFLOW_EXPORT_FORMAT_VERSION: number` (currently `1`); `WorkflowExportSchema: z.ZodType` — a Zod object with shape `{ formatVersion: number, exportedAt: string, workflow: { name: string, description: string, category: string }, version: { parameters: ParameterDefinition[], graph: WorkflowGraph } }`; `type WorkflowExport = z.infer<typeof WorkflowExportSchema>`. Both are consumed by Task 2 (backend validation) and Task 3 (frontend export assembly).

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/workflowExport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WorkflowExportSchema, WORKFLOW_EXPORT_FORMAT_VERSION } from "../src/workflowExport.js";

describe("workflow export envelope", () => {
  const validGraph = {
    nodes: [
      { id: "n1", type: "import_sample", label: "Import", position: { x: 0, y: 0 }, config: { sampleId: "expenses" } }
    ],
    edges: [],
    annotations: []
  };

  it("accepts a well-formed envelope", () => {
    const r = WorkflowExportSchema.safeParse({
      formatVersion: WORKFLOW_EXPORT_FORMAT_VERSION,
      exportedAt: "2026-07-09T12:00:00Z",
      workflow: { name: "T&E Review", description: "desc", category: "T&E" },
      version: { parameters: [], graph: validGraph }
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing workflow.name", () => {
    const r = WorkflowExportSchema.safeParse({
      formatVersion: 1,
      exportedAt: "2026-07-09T12:00:00Z",
      workflow: { description: "desc", category: "T&E" },
      version: { parameters: [], graph: validGraph }
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing version.graph", () => {
    const r = WorkflowExportSchema.safeParse({
      formatVersion: 1,
      exportedAt: "2026-07-09T12:00:00Z",
      workflow: { name: "X", description: "", category: "" },
      version: { parameters: [] }
    });
    expect(r.success).toBe(false);
  });

  it("defaults workflow.description and category when omitted", () => {
    const r = WorkflowExportSchema.safeParse({
      formatVersion: 1,
      exportedAt: "2026-07-09T12:00:00Z",
      workflow: { name: "X" },
      version: { parameters: [], graph: validGraph }
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.workflow.description).toBe("");
      expect(r.data.workflow.category).toBe("");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/domain/test/workflowExport.test.ts`
Expected: FAIL — `Cannot find module '../src/workflowExport.js'`

- [ ] **Step 3: Write the schema**

Create `packages/domain/src/workflowExport.ts`:

```ts
/**
 * Portable export/import envelope for a single workflow version.
 * See docs/superpowers/specs/2026-07-09-workflow-import-export-design.md.
 */
import { z } from "zod";
import { WorkflowGraphSchema } from "./graph.js";
import { ParameterDefinitionListSchema } from "./parameters.js";

/** Bump when the envelope shape changes in a way older readers can't parse. */
export const WORKFLOW_EXPORT_FORMAT_VERSION = 1;

export const WorkflowExportSchema = z.object({
  formatVersion: z.number().int().positive(),
  exportedAt: z.string(),
  workflow: z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    category: z.string().default("")
  }),
  version: z.object({
    parameters: ParameterDefinitionListSchema,
    graph: WorkflowGraphSchema
  })
});
export type WorkflowExport = z.infer<typeof WorkflowExportSchema>;
```

- [ ] **Step 4: Export it from the package entrypoint**

Modify `packages/domain/src/index.ts` — add a line after the existing `export * from "./entities.js";`:

```ts
export * from "./ids.js";
export * from "./enums.js";
export * from "./parameters.js";
export * from "./expression.js";
export * from "./nodes.js";
export * from "./graph.js";
export * from "./entities.js";
export * from "./workflowExport.js";
```

- [ ] **Step 5: Build the domain package**

Run: `npm run build -w @traceforge/domain`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/domain/test/workflowExport.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/workflowExport.ts packages/domain/src/index.ts packages/domain/test/workflowExport.test.ts
git commit -m "feat(domain): add versioned workflow export/import envelope schema" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Atomic import — store method, API endpoint, and tests

**Files:**
- Modify: `apps/api/src/store.ts:275` (insert `importWorkflow` after `createWorkflow` ends)
- Modify: `apps/api/src/server.ts:10-15` (imports), `apps/api/src/server.ts:137-139` (insert new route)
- Test: `apps/api/test/workflow-import.test.ts` (new)

**Interfaces:**
- Consumes: `WorkflowExportSchema`, `WORKFLOW_EXPORT_FORMAT_VERSION` from Task 1; existing `validateGraph` (`packages/domain/src/graph.ts:64`), `Store.createWorkflow` (`apps/api/src/store.ts:227`), `StoreError` (`apps/api/src/store.ts:22`).
- Produces: `Store.importWorkflow(input: { name: string; description?: string; category?: string; owner?: string; createdBy?: string; graph: WorkflowGraph; parameters: ParameterDefinition[] }): { workflow: Workflow; version: WorkflowVersion }`; HTTP route `POST /api/workflows/import` returning `201 { workflow, version }` on success, `400` on malformed envelope, `422` on unsupported `formatVersion` or invalid graph.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/workflow-import.test.ts`:

```ts
/** Integration tests for workflow import (docs/superpowers/specs/2026-07-09-workflow-import-export-design.md). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_EXPORT_FORMAT_VERSION, type WorkflowExport } from "@traceforge/domain";
import { buildApp, type AppContext } from "../src/server.js";

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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "tf-api-import-"));
  ctx = await buildApp({ dataDir });
});

afterAll(async () => {
  await ctx.app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function validEnvelope(): WorkflowExport {
  return {
    formatVersion: WORKFLOW_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workflow: { name: "Imported Test Workflow", description: "from file", category: "Test" },
    version: {
      parameters: [],
      graph: {
        nodes: [
          { id: "n1", type: "import_sample", label: "Import", position: { x: 0, y: 0 }, config: { sampleId: "expenses" } }
        ],
        edges: [],
        annotations: []
      }
    }
  };
}

describe("POST /api/workflows/import", () => {
  it("creates a new draft workflow from a valid envelope", async () => {
    const { status, json } = await api("POST", "/api/workflows/import", validEnvelope());
    expect(status).toBe(201);
    expect(json.workflow.name).toBe("Imported Test Workflow");
    expect(json.workflow.category).toBe("Test");
    expect(json.version.status).toBe("draft");
    expect(json.version.versionNumber).toBe(1);
    expect(json.version.graph.nodes.length).toBe(1);
  });

  it("rejects a malformed envelope with 400 and persists nothing", async () => {
    const before = (await api("GET", "/api/workflows?includeArchived=true")).json.length;
    const { status } = await api("POST", "/api/workflows/import", { workflow: { name: "X" } });
    expect(status).toBe(400);
    const after = (await api("GET", "/api/workflows?includeArchived=true")).json.length;
    expect(after).toBe(before);
  });

  it("rejects a newer formatVersion with 422", async () => {
    const envelope = { ...validEnvelope(), formatVersion: WORKFLOW_EXPORT_FORMAT_VERSION + 1 };
    const { status, json } = await api("POST", "/api/workflows/import", envelope);
    expect(status).toBe(422);
    expect(json.error).toMatch(/newer version/i);
  });

  it("rejects an invalid graph with 422 and persists nothing", async () => {
    const before = (await api("GET", "/api/workflows?includeArchived=true")).json.length;
    const envelope = validEnvelope();
    envelope.version.graph.edges.push({ id: "bad", source: "n1", target: "missing" });
    const { status, json } = await api("POST", "/api/workflows/import", envelope);
    expect(status).toBe(422);
    expect(json.error).toMatch(/missing/);
    const after = (await api("GET", "/api/workflows?includeArchived=true")).json.length;
    expect(after).toBe(before);
  });

  it("store.importWorkflow rolls back on failure (no orphaned workflow row)", () => {
    const before = ctx.store.listWorkflows({ includeArchived: true }).length;
    expect(() =>
      ctx.store.importWorkflow({ name: "   ", graph: { nodes: [], edges: [], annotations: [] }, parameters: [] })
    ).toThrow();
    const after = ctx.store.listWorkflows({ includeArchived: true }).length;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/test/workflow-import.test.ts`
Expected: FAIL — `store.importWorkflow is not a function` / route returns 404 for `/api/workflows/import`.

- [ ] **Step 3: Add `Store.importWorkflow`**

Modify `apps/api/src/store.ts` — insert immediately after the `createWorkflow` method closes (after line 275, before `updateWorkflowMetadata` at line 277):

```ts
  /**
   * Creates a workflow + draft v1 from an imported graph, atomically: if anything
   * after BEGIN throws, no row is left behind.
   * See docs/superpowers/specs/2026-07-09-workflow-import-export-design.md.
   */
  importWorkflow(input: {
    name: string;
    description?: string;
    category?: string;
    owner?: string;
    createdBy?: string;
    graph: WorkflowGraph;
    parameters: ParameterDefinition[];
  }): { workflow: Workflow; version: WorkflowVersion } {
    this.db.exec("BEGIN");
    try {
      const result = this.createWorkflow(input);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
```

- [ ] **Step 4: Add the `POST /api/workflows/import` route**

Modify `apps/api/src/server.ts`. First, add the new imports to the existing `@traceforge/domain` import block (lines 10-15):

```ts
import {
  validateGraph,
  validateExpression,
  newId,
  WorkflowExportSchema,
  WORKFLOW_EXPORT_FORMAT_VERSION,
  type ExpressionContext
} from "@traceforge/domain";
```

Then insert the new route after line 137 (the closing `});` of `app.post("/api/workflows", ...)`) and before line 139 (`app.get("/api/workflows/:id", ...)`):

```ts
  app.post("/api/workflows/import", async (req, reply) => {
    const parsed = WorkflowExportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new StoreError(
        `Import file is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join(" ")}`,
        400
      );
    }
    const envelope = parsed.data;
    if (envelope.formatVersion > WORKFLOW_EXPORT_FORMAT_VERSION) {
      throw new StoreError(
        "This file was exported from a newer version of TraceForge and can't be imported here.",
        422
      );
    }
    const validation = validateGraph(envelope.version.graph, { parameters: envelope.version.parameters });
    if (!validation.ok) {
      throw new StoreError(`Workflow cannot be imported: ${validation.errors.map((e) => e.message).join(" ")}`, 422);
    }
    const created = store.importWorkflow({
      name: envelope.workflow.name,
      description: envelope.workflow.description,
      category: envelope.workflow.category,
      owner: actor(),
      createdBy: actor(),
      graph: envelope.version.graph,
      parameters: envelope.version.parameters
    });
    reply.code(201);
    return created;
  });
```

- [ ] **Step 5: Build domain and api**

Run: `npm run build -w @traceforge/domain && npm run build -w @traceforge/api`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run apps/api/test/workflow-import.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the full existing lifecycle test to confirm no regression**

Run: `npx vitest run apps/api/test/lifecycle.test.ts`
Expected: PASS (unchanged)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/store.ts apps/api/src/server.ts apps/api/test/workflow-import.test.ts
git commit -m "feat(api): add atomic POST /api/workflows/import endpoint" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Export button in the version editor

**Files:**
- Modify: `apps/web/src/components.tsx:42` (add `downloadJson` helper after `fmtInt`)
- Modify: `apps/web/src/workflow.tsx:1-8` (imports), `:10-14` (`WorkflowPage` state), `:82` (pass `workflow` prop), `:99-111` (`CanvasTab` props), `:401-438` (toolbar — add `Export` button)

**Interfaces:**
- Consumes: `WORKFLOW_EXPORT_FORMAT_VERSION` from Task 1 (`@traceforge/domain`); existing `fromRfGraph` (`apps/web/src/canvas.tsx:154`); existing `VersionRow` (`apps/web/src/api.ts:83`).
- Produces: `downloadJson(filename: string, data: unknown): void` in `components.tsx`, reusable by any future export feature.

- [ ] **Step 1: Add the download helper**

Modify `apps/web/src/components.tsx` — insert after line 42 (`export const fmtInt = ...`) and before `DataPreview`:

```ts
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Thread `workflow` metadata into `CanvasTab`**

Modify `apps/web/src/workflow.tsx` line 4 (imports from `@traceforge/domain`):

```ts
import { getNodeType, newId, WORKFLOW_EXPORT_FORMAT_VERSION } from "@traceforge/domain";
```

Modify line 6 (imports from `./components`) to add `downloadJson`:

```ts
import { Badge, ErrorBox, Modal, DataPreview, ParameterInputs, fmtDate, duration, fmtInt, downloadJson } from "./components";
```

Modify the `CanvasTab` invocation at line 82, adding a `workflow` prop:

```tsx
      {tab === "canvas" && (
        <CanvasTab key={version.id} workflow={wf} version={version} datasets={datasets} readOnly={readOnly} onVersionChanged={() => reload()} navigateVersion={selectVersion} />
      )}
```

Modify the `CanvasTab` function signature (lines 99-111) to accept it:

```tsx
function CanvasTab({
  workflow,
  version,
  datasets,
  readOnly,
  onVersionChanged,
  navigateVersion
}: {
  workflow: { name: string; description: string; category: string };
  version: VersionRow;
  datasets: any[];
  readOnly: boolean;
  onVersionChanged: () => void;
  navigateVersion: (id: string) => void;
}) {
```

- [ ] **Step 3: Add the export handler and button**

Modify `apps/web/src/workflow.tsx` — insert a new function right after the existing `save` function ends (after line 323, before the `run` function at line 325):

```ts
  const exportVersion = () => {
    const graph = fromRfGraph(rfNodes, rfEdges);
    const envelope = {
      formatVersion: WORKFLOW_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      workflow: { name: workflow.name, description: workflow.description, category: workflow.category },
      version: { parameters: version.parameters, graph }
    };
    const slug = workflow.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";
    downloadJson(`${slug}-v${version.versionNumber}.json`, envelope);
  };
```

Add the button in the toolbar, immediately after the `Validate` button closes (after line 437, `</button>` for Validate, before the `▶ Run` button at line 438):

```tsx
        <button onClick={exportVersion}>Export</button>
```

- [ ] **Step 4: Typecheck**

Run: `npm run build -w @traceforge/web`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev:api` (in one terminal) and `npm run dev:web` (in another). Open the app, open any workflow's canvas tab, click **Export**. Confirm a `.json` file downloads and that opening it shows a `formatVersion`, `workflow`, and `version.graph` matching what's on the canvas.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components.tsx apps/web/src/workflow.tsx
git commit -m "feat(web): export the open workflow version to a JSON file" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Import button on the Catalog page

**Files:**
- Modify: `apps/web/src/pages.tsx:1-2` (imports), `:9-30` (`CatalogPage` state/handlers), `:54-69` (toolbar)

**Interfaces:**
- Consumes: `POST /api/workflows/import` from Task 2; existing `ErrorBox`, `api.post` (`apps/web/src/api.ts:33`).
- Produces: nothing new consumed by later tasks — this is the last functional task.

- [ ] **Step 1: Add `useRef` and a file-import handler**

Modify `apps/web/src/pages.tsx` line 2:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
```

Inside `CatalogPage`, after the existing `const load = () => ...` block (after line 29) and its `useEffect` (line 30), add:

```ts
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      const created = await api.post<any>("/api/workflows/import", envelope);
      navigate(`#/workflows/${created.workflow.id}`);
    } catch (e: any) {
      setError(e.message ?? "Could not read that file as a workflow export.");
    }
  };
```

- [ ] **Step 2: Add the Import button and hidden file input**

Modify the toolbar in `apps/web/src/pages.tsx` (lines 54-57) — add an `Import` button and a hidden `<input type="file">` right after the existing `Clone Template` button:

```tsx
      <div className="toolbar">
        <button className="primary" onClick={() => setCreateOpen(true)}>+ Workflow</button>
        <button onClick={() => navigate("#/templates")}>Clone Template</button>
        <button onClick={() => fileInputRef.current?.click()}>Import</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) importFile(file);
          }}
        />
        <input placeholder="Search name, description, service…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
```

- [ ] **Step 3: Typecheck**

Run: `npm run build -w @traceforge/web`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual verification**

With `npm run dev:api` and `npm run dev:web` running: click **Import** on the Catalog page, select the `.json` file downloaded in Task 3's manual test. Confirm you're navigated to a new workflow detail page, its name/category match the file, and its canvas shows the same nodes/edges as the exported version. Then try importing a hand-edited copy of that file with an invalid `formatVersion` (e.g. `999`) and confirm the Catalog page shows an error via `ErrorBox` instead of navigating away.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages.tsx
git commit -m "feat(web): import a workflow from an exported JSON file" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Full build and end-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full workspace build**

Run: `npm run build`
Expected: exits 0 across all workspaces (`@traceforge/domain`, `@traceforge/tabular-engine`, `@traceforge/workflow-engine`, `@traceforge/llm-gateway`, `@traceforge/evidence`, `@traceforge/api`, `@traceforge/web`).

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all suites pass, including `apps/api/test/lifecycle.test.ts`, `apps/api/test/workflow-import.test.ts`, and `packages/domain/test/workflowExport.test.ts`.

- [ ] **Step 3: Existing E2E suite (regression check)**

Run: `npm run test:e2e`
Expected: `e2e/mvp-lifecycle.spec.ts` and `e2e/zz-chart.spec.ts` still pass unmodified — confirms the new toolbar buttons didn't break existing selectors.

- [ ] **Step 4: End-to-end round trip (manual)**

With the app running (`npm run start` after the build, or `dev:api`/`dev:web`):
1. Open an existing workflow with a non-trivial graph (e.g. clone the `T&E Testing` template from the Templates page).
2. Open its canvas tab, click **Export**, save the file.
3. On the Catalog page, click **Import**, select that file.
4. Confirm the new draft workflow's canvas matches the original node-for-node.
5. Edit the exported `.json` file by hand — rename one node's `label`, add one new `import_sample` node with a fresh `id` and an edge connecting it — then Import it again.
6. Confirm the second import produces a third workflow reflecting the hand edits, proving the "export → edit as a file → re-import" loop works end-to-end.

- [ ] **Step 5: Final commit (if any cleanup was needed)**

Only if Steps 1-4 required fixes:

```bash
git add -A
git commit -m "fix: address issues found in workflow import/export smoke test" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
