# Decisions: Architecture and Product Decision Log

## What this file is for

This file records important product, architecture, security, and implementation decisions. It explains what was decided, why, and what trade-offs were accepted.

## When to read this file

Read this file when:

- Changing architecture.
- Changing data model.
- Changing workflow lifecycle behavior.
- Changing LLM provider behavior.
- Adding a major dependency.
- Reversing or questioning an existing decision.

## When not to read this file

Do not read this file for small UI copy changes or isolated bug fixes that do not affect architecture or behavior.

## Related files

- `features/README.md` — MVP feature index.
- `project.md` — global project rules.
- `features/task-creation.md` — creation behavior.
- `features/task-deletion.md` — deletion/archive behavior.
- `gates.md` — completion checks.
- `glossary.md` — definitions.

## Agent instructions

When making or changing a decision:

1. Add a new decision entry instead of silently editing history, unless correcting a typo.
2. Include context, decision, rationale, consequences, and status.
3. Link affected files where relevant.
4. Do not reverse a decision without adding a new decision entry explaining why.

---

# Decision index

| ID | Title | Status |
|---|---|---|
| ADR-001 | Build a local-first audit workflow analytics platform, not a generic n8n clone | Accepted |
| ADR-002 | Use a visual workflow canvas plus tabular analytics runtime | Accepted |
| ADR-003 | Use Tauri later; start with local web app architecture | Accepted |
| ADR-004 | Use TypeScript as the primary application language | Accepted |
| ADR-005 | Use DuckDB for local tabular analytics | Accepted |
| ADR-006 | Use local metadata storage first, with PostgreSQL-compatible path later | Accepted |
| ADR-007 | Abstract queue implementation | Accepted |
| ADR-008 | Use provider-agnostic LLM gateway with Ollama default | Accepted |
| ADR-009 | Preserve audit evidence; use archive-first deletion | Accepted |
| ADR-010 | Treat custom code and AI-generated code as untrusted | Accepted |
| ADR-011 | Use workflow versions as immutable execution units | Accepted |
| ADR-012 | Publish only verified workflow versions to toolkit | Accepted |
| ADR-013 | Canonical workflow version status vocabulary | Accepted |
| ADR-014 | Use Node built-in sqlite and @duckdb/node-api for the MVP | Accepted |
| ADR-015 | Defer fastify v4→v5 upgrade (fast-uri CVE) | Accepted |
| ADR-016 | Accept xlsx prototype-pollution risk; no npm fix available | Accepted |

---

# ADR-001: Build a local-first audit workflow analytics platform, not a generic n8n clone

## Status

Accepted

## Context

Initial research focused on low-code/no-code workflow automation platforms such as n8n, Activepieces, Windmill, Node-RED, Make, Zapier, and similar tools. Later audit-focused screenshots showed additional requirements: audit templates, workflow verification, active versions, tester/reviewer sign-off, parameterized audit tests, tabular previews, and publish-to-toolkit behavior.

## Decision

The project will be framed as a local-first audit workflow and analytics builder, not merely a generic workflow automation clone.

## Rationale

A generic automation clone would under-serve the actual audit use case. Audit users need repeatable tests, evidence, verification, reviewer sign-off, version governance, and tabular data analysis.

## Consequences

- Product model includes audit-specific metadata.
- Workflow versions and evidence retention are first-class features.
- Tabular analytics is part of the core, not a plugin.
- Generic connector marketplace is deferred.

---

# ADR-002: Use a visual workflow canvas plus tabular analytics runtime

## Status

Accepted

## Context

The screenshots show visual workflows with nodes such as Import File, Add Columns, Filter, Validate, Join, Append, Pivot, Unpivot, Python, Chart, and Publish to Toolkit. The UI also shows table previews with data types and rows.

## Decision

The app will include both:

1. A node-edge workflow orchestration engine.
2. A tabular analytics runtime for dataset transformations.

## Rationale

Audit analytics workflows are data-heavy. A pure JSON-item automation engine is not sufficient for CSV/Excel/table-based audit testing.

## Consequences

- DuckDB or equivalent is required.
- Data previews become core UI.
- Node outputs are dataset versions.
- Evidence records include dataset hashes and schema summaries.

---

# ADR-003: Use Tauri later; start with local web app architecture

## Status

Accepted

## Context

The target is a local desktop-capable app. Options include Tauri, Electron, local web app, Docker Compose, Podman, or k3s.

## Decision

Start with a local web app architecture. Add Tauri packaging after the web/API/engine foundation is stable.

## Rationale

The hard parts are workflow execution, evidence, data handling, and security. Native desktop packaging should not be the first bottleneck.

## Consequences

- MVP can run in browser against localhost.
- Later Tauri shell can wrap the same UI and backend.
- Desktop-specific features are deferred until core behavior works.

---

# ADR-004: Use TypeScript as the primary application language

## Status

Accepted

## Context

The app needs shared workflow schemas, node definitions, UI configuration, validation, and runtime execution behavior.

## Decision

Use TypeScript as the primary language for frontend, backend, workflow schema, and engine orchestration.

## Rationale

TypeScript allows shared types across the UI, API, engine, and node SDK. This reduces schema drift.

## Consequences

- React frontend and TypeScript backend share schema packages.
- Python is supported as an isolated node runtime, not as the main app language.
- Node SDK can be strongly typed.

---

# ADR-005: Use DuckDB for local tabular analytics

## Status

Accepted

## Context

Audit workflows need fast local operations over CSV, Excel, Parquet, and intermediate tables.

## Decision

Use DuckDB as the preferred local tabular execution engine.

## Rationale

DuckDB is well suited for local analytical queries and file-backed data workflows. It supports SQL-style transformations and efficient local execution.

## Consequences

- Transform nodes should compile to safe DuckDB operations where possible.
- Python/Polars may be optional for advanced operations.
- Intermediate outputs may be cached as Parquet/Arrow.

---

# ADR-006: Use local metadata storage first, with PostgreSQL-compatible path later

## Status

Accepted

## Context

The app needs workflow metadata, versions, execution logs, credentials, templates, and evidence records. SQLite is simpler for local desktop; PostgreSQL is better for team/server mode.

## Decision

Use a storage abstraction. Start with a local metadata store suitable for single-user use. Keep schema and migrations compatible with a future PostgreSQL mode where feasible.

## Rationale

The app must run locally without requiring Docker or a database server, but it should not block future team deployment.

## Consequences

- Avoid database-specific logic in domain code.
- Use migrations from day one.
- Store large datasets outside the metadata database.
- Revisit this decision before multi-user mode.

---

# ADR-007: Abstract queue implementation

## Status

Accepted

## Context

The research recommends Redis/BullMQ for distributed execution. A local desktop app may not want Redis as an MVP requirement.

## Decision

Define a queue interface. Use local/in-process or SQLite-backed queue for MVP. Add Redis/BullMQ adapter for server/team mode.

## Rationale

This preserves simple local installation while retaining a path to scale.

## Consequences

- Engine code must not import BullMQ directly.
- Queue semantics must include queued, running, succeeded, failed, cancelled, and suspended states.
- Tests must run with the local queue implementation.

---

# ADR-008: Use provider-agnostic LLM gateway with Ollama default

## Status

Accepted

## Context

The user wants local models through Ollama and optional OpenAI or Azure AI Foundry support.

## Decision

Implement an LLM gateway with provider adapters. Ollama is default. OpenAI and Azure AI Foundry are optional providers.

## Rationale

Provider abstraction prevents lock-in and supports privacy-sensitive local execution.

## Consequences

- Workflow nodes call the LLM gateway, not provider SDKs directly.
- Mock provider is required for deterministic tests.
- Cloud provider use must be explicit.
- Provider metadata is logged per run.

---

# ADR-009: Preserve audit evidence; use archive-first deletion

## Status

Accepted

## Context

Audit workflows may produce evidence. Deleting workflows could destroy history needed for audit support.

## Decision

Archive is the default deletion behavior. Hard delete is allowed only for safe, unexecuted, unverified, unpublished draft workflows.

## Rationale

Evidence retention is more important than cleanup convenience.

## Consequences

- Deletion UI must explain archive vs permanent delete.
- Evidence records remain accessible after archive.
- Hard delete requires safety checks.

---

# ADR-010: Treat custom code and AI-generated code as untrusted

## Status

Accepted

## Context

The app may support Python and AI-generated workflow/code suggestions. Custom code execution creates security risk.

## Decision

Custom code and AI-generated code are untrusted. They must not execute inside the main app process.

## Rationale

Sandbox escapes, file access, credential theft, and unsafe shell commands are high-impact risks.

## Consequences

- Python node runs in an isolated process.
- Shell command node is not part of MVP.
- Code outputs are validated.
- LLM-generated code requires review before save or execution.

---

# ADR-011: Use workflow versions as immutable execution units

## Status

Accepted

## Context

A workflow may evolve over time. Audit evidence needs to know exactly which logic produced an output.

## Decision

Executions reference immutable workflow versions. Editing a workflow creates or updates a draft version, not the executed/verified version.

## Rationale

Reproducibility requires stable version snapshots.

## Consequences

- Executed versions cannot be edited in place.
- Verified versions cannot be edited in place.
- Active version points to a verified version.
- Version history is required.

---

# ADR-012: Publish only verified workflow versions to toolkit

## Status

Accepted

## Context

Screenshots show Publish to Toolkit and version verification. Toolkit items should be trusted reusable tools.

## Decision

Only verified workflow versions can be published to toolkit.

## Rationale

Toolkit publishing implies reuse by others. Unverified drafts should not be exposed as approved tools.

## Consequences

- Publish action is disabled for draft/unverified versions.
- Publish records point to workflow version ID, not mutable workflow ID alone.
- Archive of workflow deactivates toolkit entry.

---

# ADR-013: Canonical workflow version status vocabulary

## Status

Accepted

## Context

`project.md` §6.7 lists version states as `draft, ready_for_review, verified, rejected, active, archived`, while `features/versioning.md` uses Draft, In Review, Verified, Active, Superseded, Archived. The two lists conflict (`ready_for_review` vs "In Review"; `superseded` missing from project.md).

## Decision

The canonical machine values are: `draft`, `in_review`, `verified`, `rejected`, `active`, `superseded`, `archived`. `ready_for_review` and "In Review" both map to `in_review`. `superseded` is the state of a former active version replaced by a newer activation.

## Rationale

One machine vocabulary shared by domain schemas, API, and UI prevents drift. `superseded` is required by features/versioning.md §3.3 for auditability of activation history.

## Consequences

- `packages/domain` enums and transition rules use this vocabulary.
- Allowed transitions: draft→in_review, in_review→verified|rejected|draft(amend), verified→active, active→superseded, rejected→draft, draft/verified/active/superseded→archived.
- UI labels may render friendly text ("In Review") but must not invent new states.

---

# ADR-014: Use Node built-in sqlite and @duckdb/node-api for the MVP

## Status

Accepted

## Context

ADR-006 chose SQLite for local metadata. `better-sqlite3` requires native prebuilt binaries or a node-gyp toolchain, which fails on very new Node releases and offline/restricted environments — conflicting with local-first, zero-toolchain installation. Node ≥22.13 ships a built-in `node:sqlite` module. For the tabular engine, the modern DuckDB client is `@duckdb/node-api` (published with prerelease-style versions, pinned exactly).

## Decision

Use `node:sqlite` (`DatabaseSync`) for the metadata store and pin `@duckdb/node-api` for tabular analytics. Keep all SQLite access behind the `Store` repository class so a different driver (or PostgreSQL) can replace it later per ADR-006.

## Rationale

No native build step for metadata storage; installation works with plain `npm install` on a current Node. DuckDB neo ships prebuilt binaries for all major platforms.

## Consequences

- Minimum Node version is 22.13+ (documented in README).
- `node:sqlite` emits an experimental warning; API surface used is minimal (exec/prepare/run/get/all).
- `node:sqlite` cannot be resolved statically by vite/vitest, so it is loaded via `process.getBuiltinModule`.
- Revisit if multi-user/server mode needs PostgreSQL (ADR-006 path unchanged).

---

# ADR-015: Defer fastify v4→v5 upgrade (fast-uri CVE)

## Status

Accepted

## Context

`npm audit` flagged a `fast-uri` vulnerability reachable via `fastify`. The issue involves unsafe URI normalization — encoded path segments like `%2e%2e` may be treated as real `..`, and encoded authority delimiters like `%40` can confuse host parsing. The reported fix is to upgrade to `fastify@5.10.0`, which is a breaking major version jump.

## Decision

Defer the upgrade from `fastify@^4.28.0` to v5.

## Rationale

The vulnerability is not exercisable in this app. The API server in `apps/api/src/server.ts` binds to localhost only (`project.md §8.4`). Route parameters are used as opaque IDs (`req.params as { id: string }`) and never re-parsed as URLs. There are no user-controlled redirect targets, proxy calls, or URL allowlist comparisons — the specific patterns the `fast-uri` bug targets.

Additionally, Fastify v5 is a breaking major version: it requires Node ≥ 20, and all three plugins (`@fastify/cors`, `@fastify/multipart`, `@fastify/static`) would each need a coordinated major-version bump. The `@fastify/multipart` v9 API change is the highest-risk point given the file upload path at `POST /api/datasets/import`. The cost of upgrading exceeds the security benefit while the app is localhost-only.

## Consequences

- Revisit if the app is ever exposed beyond localhost.
- Revisit if a Node runtime upgrade triggers compatibility issues with v4 plugins.
- When upgrading, all three plugins must be bumped together: `@fastify/cors@10.x`, `@fastify/multipart@9.x`, `@fastify/static@8.x`.

---

# ADR-016: Accept xlsx prototype-pollution risk; no npm fix available

## Status

Accepted

## Context

`npm audit` flagged `xlsx@^0.18.5` (SheetJS Community Edition) for a prototype pollution vulnerability and a ReDoS issue. GitHub's advisory states the npm package is no longer maintained and no non-vulnerable version is available through npm.

## Decision

Accept the risk and continue using `xlsx` at the current version.

## Rationale

The prototype pollution issue is triggered by parsing a specially crafted file — the attack surface is `readWorkbook()`'s call to `XLSX.read()` in `packages/tabular-engine/src/importers.ts` (line 11, called from lines 49 and 78), reached when a user uploads an `.xlsx` file. However, because the server is localhost-only (`project.md §8.4`), an attacker would need local machine access to deliver a crafted file, which already implies a more privileged position than the vulnerability provides.

The export path in `packages/tabular-engine/src/preview.ts` uses only write-side APIs (`json_to_sheet`, `writeFile`) against trusted internal Parquet data and is not affected by this vulnerability.

The two alternatives carry real cost: replacing `xlsx` with `exceljs` requires API changes across both `importers.ts` and `preview.ts`; adopting SheetJS Pro requires a commercial license. Given the localhost scope, accepting the risk is the proportionate response.

## Consequences

- This decision must be revisited before any deployment that exposes the API beyond localhost.
- If that boundary changes, replacing `xlsx` with `exceljs` is the preferred remediation path — the affected surface is small: two buffer-based `XLSX.read()` calls in `importers.ts` and the `XLSX.utils.*` / buffer-based `XLSX.write()` calls in `preview.ts`.
