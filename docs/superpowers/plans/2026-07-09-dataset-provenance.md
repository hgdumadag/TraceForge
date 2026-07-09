# Dataset Provenance (Workflow/Run Attribution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store which workflow and which execution produced each node-output dataset, and surface that on the Datasets page, so repeated runs that produce identically-named datasets (e.g. many "Edit Columns — output" rows) are distinguishable.

**Architecture:** Add four nullable columns to the `datasets` table (`source_workflow_id`, `source_workflow_name`, `source_execution_id`, `executed_at`), populate them at node-output creation time from data the execution service already holds in memory, and render two new columns ("Workflow", "Run") on the Datasets table. Full design rationale lives in `docs/superpowers/specs/2026-07-09-dataset-provenance-design.md`.

**Tech Stack:** TypeScript, Fastify, `node:sqlite`, Zod, React, Vitest (integration tests via Fastify's `.inject()`).

## Global Constraints

- The generated dataset **name** (`"${nodeLabel} — ${handle}"`) does not change — provenance is additive, in new fields/columns only.
- `sourceWorkflowName` is a **snapshot** captured at run time, not a live lookup — renaming a workflow later must not change what past datasets display.
- All four new columns are nullable; every non-`node_output` dataset kind (imported file, sample, manual table, API import) leaves them `null` with no changes to those code paths.
- No new uniqueness/dedup constraints on dataset names.
- Follow the existing single-file convention: this repo has one backend integration test file (`apps/api/test/lifecycle.test.ts`) exercising the whole API through Fastify's `.inject()`, and no per-module unit test files — extend that file rather than creating new test files.

---

### Task 1: Data model — schema, migration, store layer

**Files:**
- Modify: `packages/domain/src/entities.ts:61-68` (`DatasetSchema`)
- Create: `apps/api/migrations/002_dataset_provenance.sql`
- Modify: `apps/api/src/store.ts:581-606` (`createDataset`, `getDataset`, `listDatasets`)
- Test: `apps/api/test/lifecycle.test.ts` (extend test `"2. imports a CSV dataset with fingerprint"`)

**Interfaces:**
- Produces: `Dataset` type gains `sourceWorkflowId: string | null`, `sourceWorkflowName: string | null`, `sourceExecutionId: string | null`, `executedAt: string | null`. `store.createDataset(name: string, kind: Dataset["kind"], provenance?: { sourceWorkflowId: string; sourceWorkflowName: string; sourceExecutionId: string; executedAt: string })` — the new third parameter is optional; every existing call site (file import, sample/template creation, manual table creation) keeps calling with two arguments and gets all four fields as `null`.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/lifecycle.test.ts`, inside `it("2. imports a CSV dataset with fingerprint", ...)`, add these lines right after the existing `expect(json.datasetVersion.columns.map(...))` assertion (currently the last line of that test, just before the test's closing `});`):

```ts
    expect(json.dataset.sourceWorkflowId).toBeNull();
    expect(json.dataset.sourceWorkflowName).toBeNull();
    expect(json.dataset.sourceExecutionId).toBeNull();
    expect(json.dataset.executedAt).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/test/lifecycle.test.ts -t "2. imports"`
Expected: FAIL — `expect(undefined).toBeNull()` (the fields don't exist yet on the returned `dataset` object).

- [ ] **Step 3: Add the schema fields**

In `packages/domain/src/entities.ts`, replace the `DatasetSchema` block (lines 61-68):

```ts
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
```

- [ ] **Step 4: Add the migration**

Create `apps/api/migrations/002_dataset_provenance.sql`:

```sql
-- Adds workflow/run provenance to node-output datasets so repeated runs
-- of the same node type are distinguishable in the Datasets list.
ALTER TABLE datasets ADD COLUMN source_workflow_id TEXT;
ALTER TABLE datasets ADD COLUMN source_workflow_name TEXT;
ALTER TABLE datasets ADD COLUMN source_execution_id TEXT;
ALTER TABLE datasets ADD COLUMN executed_at TEXT;
```

The migration runner (`apps/api/src/db.ts`) applies any `.sql` file in this directory not yet recorded in `_migrations`, in filename order — no other wiring needed.

- [ ] **Step 5: Update the store layer**

In `apps/api/src/store.ts`, replace `createDataset` (lines 581-585):

```ts
  createDataset(
    name: string,
    kind: Dataset["kind"],
    provenance?: { sourceWorkflowId: string; sourceWorkflowName: string; sourceExecutionId: string; executedAt: string }
  ): Dataset {
    const id = newId("ds");
    this.db
      .prepare(
        "INSERT INTO datasets (id, name, kind, created_at, source_workflow_id, source_workflow_name, source_execution_id, executed_at) VALUES (?,?,?,?,?,?,?,?)"
      )
      .run(
        id,
        name,
        kind,
        nowIso(),
        provenance?.sourceWorkflowId ?? null,
        provenance?.sourceWorkflowName ?? null,
        provenance?.sourceExecutionId ?? null,
        provenance?.executedAt ?? null
      );
    return this.getDataset(id);
  }
```

Replace `getDataset` (lines 587-591):

```ts
  getDataset(id: string): Dataset {
    const row = this.db.prepare("SELECT * FROM datasets WHERE id=?").get(id) as any;
    if (!row) throw new StoreError(`Dataset ${id} was not found.`, 404);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      kind: row.kind,
      createdAt: row.created_at,
      sourceWorkflowId: row.source_workflow_id ?? null,
      sourceWorkflowName: row.source_workflow_name ?? null,
      sourceExecutionId: row.source_execution_id ?? null,
      executedAt: row.executed_at ?? null
    };
  }
```

Replace the row-mapping line inside `listDatasets` (lines 600-606):

```ts
  listDatasets(kinds?: Dataset["kind"][]): (Dataset & { latestVersion: DatasetVersion | null })[] {
    const rows = this.db.prepare("SELECT * FROM datasets ORDER BY created_at DESC").all() as any[];
    return rows
      .map(
        (row) =>
          ({
            id: row.id,
            workspaceId: row.workspace_id,
            name: row.name,
            kind: row.kind,
            createdAt: row.created_at,
            sourceWorkflowId: row.source_workflow_id ?? null,
            sourceWorkflowName: row.source_workflow_name ?? null,
            sourceExecutionId: row.source_execution_id ?? null,
            executedAt: row.executed_at ?? null
          }) as Dataset
      )
      .filter((d) => !kinds || kinds.includes(d.kind))
      .map((d) => ({ ...d, latestVersion: this.latestDatasetVersion(d.id) }));
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run apps/api/test/lifecycle.test.ts`
Expected: PASS — all tests in the file, including test 2's new assertions (`null` fields on an imported dataset).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/entities.ts apps/api/migrations/002_dataset_provenance.sql apps/api/src/store.ts apps/api/test/lifecycle.test.ts
git commit -m "feat: add workflow/run provenance fields to dataset schema"
```

---

### Task 2: Populate provenance at run time

**Files:**
- Modify: `apps/api/src/executions.ts:53-88` (`ExecutionService.start`)
- Modify: `apps/api/src/runtime.ts:63-105` (`RuntimeDeps`, `registerOutput`)
- Test: `apps/api/test/lifecycle.test.ts` (extend tests `"6. runs the workflow..."` and `"13. rerun creates a linked execution..."`)

**Interfaces:**
- Consumes: `Dataset` fields and `store.createDataset(name, kind, provenance?)` from Task 1.
- Produces: every `node_output` dataset now has `sourceWorkflowId`/`sourceWorkflowName` set to the workflow that ran it, and `sourceExecutionId`/`executedAt` identical across every output of one execution, differing across separate executions.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/lifecycle.test.ts`, add a new shared variable alongside the other `let` declarations at the top of the `describe` block (currently lines 49-53):

```ts
  let workflowId: string;
  let draftVersionId: string;
  let expensesDsvId: string;
  let executionId: string;
  let v2Id: string;
  let firstRunExecutedAt: string;
```

In `it("6. runs the workflow with parameters; run history and node results persist", ...)`, add this after the existing final assertion (`expect(preview.totalRows).toBeGreaterThan(0);`), still inside the test:

```ts
    // Node outputs from this run all carry the same workflow/run identity.
    const { json: nodeOutputs } = await api("GET", "/api/datasets?kinds=node_output");
    const fromThisRun = nodeOutputs.filter((d: any) => d.sourceExecutionId === executionId);
    expect(fromThisRun.length).toBeGreaterThan(0);
    for (const d of fromThisRun) {
      expect(d.sourceWorkflowId).toBe(workflowId);
      expect(d.sourceWorkflowName).toBe("T&E Testing — FY26");
      expect(d.executedAt).toBeTruthy();
    }
    firstRunExecutedAt = fromThisRun[0].executedAt;
    expect(new Set(fromThisRun.map((d: any) => d.executedAt)).size).toBe(1);
```

In `it("13. rerun creates a linked execution with same parameters", ...)`, add this after `expect(detail.execution.triggerType).toBe("rerun");`, still inside the test:

```ts
    const { json: nodeOutputs } = await api("GET", "/api/datasets?kinds=node_output");
    const fromRerun = nodeOutputs.filter((d: any) => d.sourceExecutionId === rerun.json.id);
    expect(fromRerun.length).toBeGreaterThan(0);
    expect(fromRerun[0].executedAt).not.toBe(firstRunExecutedAt);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/test/lifecycle.test.ts`
Expected: FAIL on test 6 — `fromThisRun.length` is `0` because no `node_output` dataset has a non-null `sourceExecutionId` yet.

- [ ] **Step 3: Thread provenance through `RuntimeDeps`**

In `apps/api/src/runtime.ts`, replace the `RuntimeDeps` interface (lines 63-68):

```ts
export interface RuntimeDeps {
  store: Store;
  paths: AppPaths;
  gateway: LlmGateway;
  actor: string;
  sourceWorkflowId: string;
  sourceWorkflowName: string;
  sourceExecutionId: string;
  executedAt: string;
}
```

Replace `registerOutput` (lines 81-105) so it passes provenance into `store.createDataset`:

```ts
  private registerOutput(
    nodeLabel: string,
    handle: string,
    info: { rowCount: number; columns: { name: string; type: string }[]; contentHash: string },
    path: string
  ): PortData {
    const dataset = this.deps.store.createDataset(`${nodeLabel} — ${handle}`, "node_output", {
      sourceWorkflowId: this.deps.sourceWorkflowId,
      sourceWorkflowName: this.deps.sourceWorkflowName,
      sourceExecutionId: this.deps.sourceExecutionId,
      executedAt: this.deps.executedAt
    });
    const dsv = this.deps.store.createDatasetVersion({
      datasetId: dataset.id,
      storagePath: path,
      contentHash: info.contentHash,
      sourceFileName: null,
      sourceFileHash: null,
      sourceFileSize: null,
      rowCount: info.rowCount,
      columns: info.columns as never
    });
    return {
      datasetVersionId: dsv.id,
      path,
      columns: info.columns,
      rowCount: info.rowCount,
      contentHash: info.contentHash
    };
  }
```

- [ ] **Step 4: Construct the runtime after the run's start time is known**

In `apps/api/src/executions.ts`, in `ExecutionService.start()`, remove the current `const runtime = new ApiNodeRuntime({ store: this.store, paths: this.paths, gateway: this.gateway, actor: input.actor });` line (currently line 67, right after `createExecution`).

Then, inside `await this.queue.enqueue({ executionId: execution.id, run: async (signal) => { ... } })`, insert the runtime construction right after `const startedAt = nowIso();` (currently line 72):

```ts
    await this.queue.enqueue({
      executionId: execution.id,
      run: async (signal) => {
        const startedAt = nowIso();
        const runtime = new ApiNodeRuntime({
          store: this.store,
          paths: this.paths,
          gateway: this.gateway,
          actor: input.actor,
          sourceWorkflowId: workflow.id,
          sourceWorkflowName: workflow.name,
          sourceExecutionId: execution.id,
          executedAt: startedAt
        });
        this.store.updateExecution(execution.id, { status: "running", startedAt });
        this.emit({ type: "execution", executionId: execution.id, data: { status: "running", startedAt } });
        try {
          const result = await executeWorkflow({
```

Everything after this point in the same callback (`executeWorkflow({ ..., runtime, ... })` and `runtime.usedInputDatasetVersions`) already refers to `runtime` from within this same closure, so no further changes are needed there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/api/test/lifecycle.test.ts`
Expected: PASS — all tests, including the new assertions in tests 6 and 13.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/executions.ts apps/api/src/runtime.ts apps/api/test/lifecycle.test.ts
git commit -m "feat: populate workflow/run provenance on node-output datasets"
```

---

### Task 3: Datasets page — Workflow and Run columns

**Files:**
- Modify: `apps/web/src/pages.tsx:374,376-394` (`DatasetsPage`)

**Interfaces:**
- Consumes: `d.sourceWorkflowName: string | null` and `d.executedAt: string | null` from the `GET /api/datasets` response (Task 1 + Task 2), and the existing `fmtDate` helper already imported at the top of `pages.tsx`.

- [ ] **Step 1: Add the table columns**

In `apps/web/src/pages.tsx`, replace the header row (line 374):

```tsx
          <thead><tr><th>Name</th><th>Kind</th><th>Workflow</th><th>Run</th><th>Rows</th><th>Columns</th><th>Source file</th><th>Fingerprint</th><th>Imported</th><th></th></tr></thead>
```

Insert two `<td>`s between the existing Kind cell and Rows cell (currently lines 379-380):

```tsx
                <td><span className="chip">{d.kind.replace(/_/g, " ")}</span></td>
                <td className="dim">{d.sourceWorkflowName ?? "—"}</td>
                <td className="dim">{d.executedAt ? fmtDate(d.executedAt) : "—"}</td>
                <td>{d.latestVersion?.rowCount ?? "—"}</td>
```

Update the empty-state row's `colSpan` (currently line 394):

```tsx
            {datasets.length === 0 && <tr><td colSpan={10} className="empty">No datasets yet. Import a file to get started.</td></tr>}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev:api` in one terminal and `npm run dev:web` in another (from the repo root).

In the browser: open the Datasets page, run the same workflow twice from the Workflows page, and confirm:
- Two rows with the same Name/Kind now show the workflow's name in the Workflow column and two different timestamps in the Run column.
- An imported file's row shows "—" in both new columns.
- The empty state (if reachable, e.g. in a fresh workspace) still renders without a layout break.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages.tsx
git commit -m "feat: show workflow and run columns on the Datasets page"
```
