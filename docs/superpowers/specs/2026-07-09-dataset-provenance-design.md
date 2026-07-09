# Dataset Provenance (Workflow/Run Attribution) — Design Spec

**Goal:** Make node-output datasets distinguishable from one another in the Datasets list. Today every run of the same node produces a new `Dataset` row named `"${nodeLabel} — ${handle}"` (e.g. `"Edit Columns — output"`) with no stored link back to the workflow or run that produced it — repeated runs of the same workflow, or of different workflows that happen to use the same node type, are indistinguishable except by an opaque SHA-256 fingerprint and a bare timestamp.

**Primary use case:** a user has run several workflows (or the same workflow several times) and opens the Datasets page looking for "the output from Workflow X's most recent run" among many identically-named rows.

## Non-goals (explicitly out of scope)

- Changing the auto-generated dataset **name** string itself (e.g. embedding the workflow or run into `d.name`). The name stays exactly `"${nodeLabel} — ${handle}"`; disambiguation is additive, via new columns.
- Any uniqueness/dedup enforcement on dataset names — duplicate names remain allowed, as they are today for every dataset kind.
- Resolving the workflow name live from the current workflow record. The workflow name is captured as a snapshot at run time (see Design decisions log) so a later rename does not rewrite history.
- Storing the workflow **version** or **node id** on the dataset. Only workflow identity (id + name snapshot) and run identity (execution id + start time) are captured; deeper lineage (which graph version, which specific node instance) is already available via `node_executions`/`executions` for anyone who needs to dig further.
- Any change to how imported files, samples, manual tables, or API imports are created or displayed — their provenance fields are simply `null`, unchanged from today's behavior in every other respect.

## Data model changes

Add four nullable columns to `datasets` (nullable because they only apply to `kind = "node_output"`; every other kind leaves them `null`):

```ts
// packages/domain/src/entities.ts — DatasetSchema
export const DatasetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string().min(1),
  kind: z.enum(["imported_file", "sample", "manual_table", "node_output", "api_import"]),
  createdAt: z.string(),
  sourceWorkflowId: z.string().nullable(),
  sourceWorkflowName: z.string().nullable(),
  sourceExecutionId: z.string().nullable(),
  executedAt: z.string().nullable()
});
```

- `sourceWorkflowId` — stable id of the workflow that produced this dataset, for future "jump to workflow" linking.
- `sourceWorkflowName` — a **snapshot** of the workflow's name at the moment it ran. Matches the app's existing "immutable snapshot for audit reproducibility" philosophy already stated on the Datasets page; a later rename must not retroactively relabel past outputs.
- `sourceExecutionId` — id of the specific execution (run) that produced this dataset.
- `executedAt` — the execution's start time. Every output produced during one run shares this exact value, which is what lets multiple rows be recognized as belonging to the same run, distinct from `createdAt` (the per-dataset creation moment, which can differ by milliseconds between nodes in the same run).

New migration `apps/api/migrations/002_dataset_provenance.sql` (only `001_init.sql` exists today):

```sql
ALTER TABLE datasets ADD COLUMN source_workflow_id TEXT;
ALTER TABLE datasets ADD COLUMN source_workflow_name TEXT;
ALTER TABLE datasets ADD COLUMN source_execution_id TEXT;
ALTER TABLE datasets ADD COLUMN executed_at TEXT;
```

All nullable, so existing rows backfill as `NULL` with no data loss and no backfill script needed.

`store.ts` changes:

- `createDataset(name, kind)` (currently `store.ts:581`) gains an optional third parameter:
  ```ts
  createDataset(
    name: string,
    kind: Dataset["kind"],
    provenance?: { sourceWorkflowId: string; sourceWorkflowName: string; sourceExecutionId: string; executedAt: string }
  ): Dataset
  ```
  The `INSERT` writes the four new columns (defaulting to `null` when `provenance` is omitted). Every existing call site (`server.ts:285` file import, `templates.ts:82,86` sample/template creation, `server.ts:308` manual table creation) keeps calling with two args and is unaffected.
- `getDataset` (`store.ts:587`) and `listDatasets` (`store.ts:600`) include the four new fields when mapping DB rows back to `Dataset` objects.

## Population flow

The execution path (`apps/api/src/executions.ts`, `ExecutionService.start()`) already holds everything needed — it just isn't threaded through to dataset creation:

- `workflow` is already fetched at line 55 (`this.store.getWorkflow(version.workflowId)`).
- `execution` is already created at line 57.
- `startedAt` is computed at line 72, inside the queue's `run` callback — **after** `ApiNodeRuntime` is currently constructed at line 67.

**Change 1 — `executions.ts`:** move the `new ApiNodeRuntime(...)` construction from line 67 into the `run: async (signal) => { ... }` callback, after `const startedAt = nowIso()` (line 72), passing the new context:

```ts
const runtime = new ApiNodeRuntime({
  store: this.store, paths: this.paths, gateway: this.gateway, actor: input.actor,
  sourceWorkflowId: workflow.id,
  sourceWorkflowName: workflow.name,
  sourceExecutionId: execution.id,
  executedAt: startedAt
});
```

**Change 2 — `runtime.ts`:** `RuntimeDeps` (`runtime.ts:63`) gains the four fields. `registerOutput` (`runtime.ts:87`) forwards them to `store.createDataset`:

```ts
const dataset = this.deps.store.createDataset(`${nodeLabel} — ${handle}`, "node_output", {
  sourceWorkflowId: this.deps.sourceWorkflowId,
  sourceWorkflowName: this.deps.sourceWorkflowName,
  sourceExecutionId: this.deps.sourceExecutionId,
  executedAt: this.deps.executedAt
});
```

No other node-runtime code path changes — `import_file`, `import_sample`, and `import_api` reuse existing dataset versions or go through the same `registerOutput`, so they inherit this automatically.

## API + UI changes

**API (`apps/api/src/server.ts:256-260`):** no change. `GET /api/datasets` returns `store.listDatasets(kinds)` directly; the new fields flow to the frontend as soon as `Dataset` carries them.

**Frontend (`apps/web/src/pages.tsx`, `DatasetsPage`, lines 331-397):** `datasets` is untyped (`useState<any[]>`), so no type migration is required. Add two columns, positioned right after **Kind** and before **Rows**:

```tsx
<thead><tr><th>Name</th><th>Kind</th><th>Workflow</th><th>Run</th><th>Rows</th><th>Columns</th><th>Source file</th><th>Fingerprint</th><th>Imported</th><th></th></tr></thead>
...
<td className="dim">{d.sourceWorkflowName ?? "—"}</td>
<td className="dim">{d.executedAt ? fmtDate(d.executedAt) : "—"}</td>
```

This placement groups "what is it → where did it come from → what's its shape" and sits naturally alongside **Source file** later in the row — exactly one of the two origin columns is ever populated per row, depending on `kind`. Bump the empty-state row's `colSpan={8}` to `colSpan={10}` (line 394).

## Testing

- **`apps/api/test/lifecycle.test.ts`, test 6** ("runs the workflow with parameters; run history and node results persist", line 117): after the run completes, assert the resulting `node_output` datasets have `sourceWorkflowId === workflow.id`, `sourceWorkflowName === workflow.name`, `sourceExecutionId === execution.id`, and non-null `executedAt`.
- **Regression case near test 2** ("imports a CSV dataset with fingerprint", line 75): assert the imported dataset's four provenance fields are all `null`.
- **Store-level unit check:** two node outputs from the *same* execution get an identical `executedAt`; two outputs from *separate* runs of the same workflow get different ones. This is the crux of the run-grouping behavior and is worth asserting directly rather than only implicitly.
- **Frontend:** no existing unit tests for `pages.tsx`; verify manually (or via a Playwright addition under `e2e/`) that running a workflow twice produces two rows with identical Name/Kind but distinguishable Workflow+Run columns, and that imported files show "—" in both new columns.

## Known limitations (documented, not engineered around)

- If a workflow is deleted, `sourceWorkflowId` becomes a dangling reference (no FK enforcement) — `sourceWorkflowName` still displays correctly since it's a snapshot, so this only affects a future "jump to workflow" link, which would need to handle a missing target gracefully.
- Duplicate dataset names remain fully allowed, as they are today for every kind; this design does not add any uniqueness constraint.

## Design decisions log

| Decision | Choice | Reasoning |
|---|---|---|
| Scope | Fix the data model (store workflow/run info on the dataset) + display it, not just a read-time join | The linkage isn't stored anywhere today (`executions`/`node_executions` only point forward to dataset version ids); a display-only join would be fragile and wouldn't survive if that link is ever needed elsewhere |
| Naming | Keep the generated name (`"${nodeLabel} — ${handle}"`) unchanged; show provenance in new columns only | Keeps names short and readable; avoids clutter in exports/dropdowns elsewhere in the app that reuse `dataset.name` |
| Run identifier | Execution start timestamp, not a sequential per-workflow run number | Reuses data the executions table already produces (`startedAt`); a run counter would require new state with no other use case today |
| Workflow name storage | Snapshot at run time, not a live lookup via `sourceWorkflowId` | Matches the app's existing "immutable snapshot for audit reproducibility" philosophy; a later rename must not rewrite what already ran |
| Column placement | Workflow + Run go right after Kind, before Rows | Groups "where did this come from" near "what is it," and sits next to the analogous Source file column later in the row |
