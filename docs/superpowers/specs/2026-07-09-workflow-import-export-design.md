# Workflow Import/Export — Design Spec

**Goal:** Let a workflow version be exported to a standalone JSON file, and let that file (hand-written, AI-authored, or a previous export) be imported back into the app as a brand-new draft workflow — without going through the canvas UI to build the graph node-by-node.

**Primary use case:** a user (or an AI acting on their behalf) authors or edits a workflow's node/edge graph outside the app — either from scratch, or by exporting an existing draft, editing the JSON, and re-importing it — then brings the result into TraceForge as a normal draft workflow that goes through the existing draft → in_review → verified → active lifecycle unchanged.

## Non-goals (explicitly out of scope)

- Updating an existing workflow on import. Every import creates a **new** workflow; re-importing an edited export produces a sibling draft, not a new version of the original.
- Bulk export/import of a workflow's full version history — only one version at a time.
- Validating that dataset references (`datasetParameterKey`, or a hard-coded `datasetVersionId` in a node's config) resolve on the target instance. This is a run-time concern today and stays that way; a hard-coded `datasetVersionId` from another instance will import successfully but fail when run, until repointed.
- Any file-system watch-folder / auto-import-on-startup mechanism. Import is always an explicit user action through the UI.

## File format

A stable envelope, versioned independently of internal DB/API shapes so exported files keep working across app upgrades:

```json
{
  "formatVersion": 1,
  "exportedAt": "2026-07-09T12:00:00Z",
  "workflow": {
    "name": "Travel & Expense Review",
    "description": "...",
    "category": "T&E"
  },
  "version": {
    "parameters": [
      { "key": "expenses", "label": "Expenses", "type": "dataset", "required": true }
    ],
    "graph": {
      "nodes": [ { "id": "...", "type": "...", "label": "...", "position": { "x": 0, "y": 0 }, "config": {} } ],
      "edges": [ { "id": "...", "source": "...", "sourceHandle": "output", "target": "...", "targetHandle": "input" } ],
      "annotations": []
    }
  }
}
```

`workflow.*` matches the relevant subset of `WorkflowSchema` (`packages/domain/src/entities.ts`); `version.parameters`/`version.graph` match `WorkflowGraphSchema` (`packages/domain/src/graph.ts`) and the parameter definitions in `packages/domain/src/parameters.ts`. `formatVersion` allows the import endpoint to reject files from a newer app version with a clear message instead of a confusing validation failure.

## Architecture

**Export is client-side only — no new backend endpoint.** The version editor (`apps/web/src/canvas.tsx` / `workflow.tsx`) already holds the open version's `graph`/`parameters` and the parent workflow's `name`/`description`/`category` in memory (it needs them to render). "Export" assembles the envelope object client-side and triggers a browser download via `Blob` + a temporary `<a download>` element. Exports whichever version is currently open — draft, in_review, verified, or active.

**Import requires a new backend endpoint**, since only the server writes to SQLite:

`POST /api/workflows/import` — body is the envelope.

Validation, in order, nothing persisted until all steps pass:
1. **Envelope shape** — `formatVersion`, `workflow.name`, `workflow.category`, `version.graph`, `version.parameters` all present. Missing/malformed → `400` with a specific message.
2. **`formatVersion` check** — if the file declares a version newer than this app supports → `422`, `"This file was exported from a newer version of TraceForge and can't be imported here."`
3. **Graph validation** — the embedded `graph` runs through the existing `validateGraph()` (`packages/domain/src/graph.ts`), the same gate `PUT /api/versions/:id` already uses (unknown node types, cycles, missing required inputs, bad edge references). Failure → `422` with the same structured error shape the in-app editor already surfaces.
4. **Persist** — `createWorkflow` + version-creation, reusing the same store functions the normal `POST /api/workflows` path uses, wrapped in one DB transaction. Either both rows are written, or neither is.

Response on success: `201` with `{ workflow, version }` — identical shape to `POST /api/workflows`, so the frontend reuses its existing "created workflow" handling (e.g. navigate to the new draft).

## UI placement

- **Export button** — in the version editor toolbar, next to existing save/status controls. Always exports the version currently open.
- **Import button** — in the Catalog page toolbar (`apps/web/src/pages.tsx`, alongside the existing `+ Workflow` and `Clone Template` buttons). Opens a native file picker restricted to `.json`, reads the file client-side with `FileReader`, `POST`s the parsed JSON to `/api/workflows/import`, and on success navigates to the new draft — mirroring what `+ Workflow` already does after creation.
- **Error handling** — reuse the existing `ErrorBox` component and `setError(e.message)` pattern already used for `Duplicate`/`Archive` failures on the Catalog page. No new error-display component.

## Testing

- **Backend integration test** (alongside `apps/api/test/lifecycle.test.ts`): export-shaped payload → `POST /api/workflows/import` → `201` → `GET` the new version → graph matches what was sent. Negative cases: malformed envelope → `400`; unsupported `formatVersion` → `422`; invalid graph (unknown node type, a cycle) → `422`, and confirm nothing was persisted (workflow count unchanged).
- **Frontend**: no new component logic beyond wiring existing patterns (file read, `api.post`, `ErrorBox`) — a manual smoke test (export a template-based workflow, re-import it, confirm the new draft matches) is sufficient; no new test infra required.

## Known limitations (documented, not engineered around)

- Hard-coded `datasetVersionId` references in node configs won't resolve if imported into a different instance — surfaces as a run-time error, not an import-time one.
- Import always creates a new workflow; there is no "update existing workflow from file" flow in this scope.
- Single-version export/import only; no workflow-history bundling.

## Design decisions log

| Decision | Choice | Reasoning |
|---|---|---|
| Import target | Always create a new workflow | Simplest, no collision/matching rules needed; matches primary use case (AI-authored or hand-edited files becoming new drafts) |
| Export format | Stable versioned envelope, not a mirror of the API response | Insulates hand-authored/AI-authored files from internal API/DB shape changes across app upgrades |
| Export scope | Whichever version is currently open in the editor | Directly supports the "export a draft, hand to AI, re-import" loop |
| Import implementation | New atomic endpoint (`POST /api/workflows/import`), wrapping existing store functions in a transaction | Avoids orphaned/broken draft workflows in the catalog when validation fails partway through |
