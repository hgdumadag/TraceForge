# Project Specification: Local Audit Workflow & Analytics Builder (TraceForge)

## What this file is for

This is the primary context file for the project. It explains the product, scope, architecture, domain model, global rules, and engineering constraints for a local-first audit workflow and analytics builder.

The product is inspired by workflow automation tools such as n8n, Activepieces, Windmill, Node-RED, Make, and audit-focused workflow apps that combine visual workflow design, tabular data preparation, audit test templates, execution history, version verification, and evidence retention.

## When to read this file

Read this file before almost every implementation task, especially when touching:

- Core architecture
- Data model
- Workflow canvas
- Execution engine
- Dataset handling
- LLM integration
- Security and privacy
- Audit evidence and verification behavior
- Local-first deployment behavior

## When not to read this file

Do not re-read this file for a small, isolated code fix when all required context is already contained in the relevant feature spec and the change does not affect global behavior.

## Related files

- `features/task-creation.md` — behavior and tests for creating a workflow/audit test task.
- `features/task-deletion.md` — behavior and tests for deleting or archiving a workflow/audit test task.
- `gates.md` — required checks before work is considered done.
- `decisions.md` — important architectural and product decisions.
- `glossary.md` — definitions of project terms.

## Agent instructions

Before making changes:

1. Read only the minimum files needed for the task.
2. Treat this file as the source of truth for global behavior.
3. Do not invent architecture that conflicts with `decisions.md`.
4. Preserve local-first behavior unless a task explicitly changes it.
5. Never send user data, audit data, credentials, or execution payloads to a cloud LLM unless the user explicitly selected a cloud provider for that run.
6. Prefer small, testable changes over broad rewrites.
7. Update the relevant feature spec or decision record when behavior changes.

---

# 1. Product summary

The project is a local-first desktop/web application for building, running, verifying, and reusing audit analytics workflows.

It combines four product ideas:

1. **Workflow automation canvas** — a node-and-edge workflow builder similar to n8n, Activepieces, Node-RED, or Make.
2. **Tabular analytics workbench** — file import, filters, joins, pivots, deduplication, validation rules, formulas, and data previews similar to Power Query, Alteryx, Tableau Prep, or an audit data analytics tool.
3. **Audit governance layer** — templates, workflow versions, tester/reviewer verification, pass/fail/amend review, active version activation, run history, evidence retention, and publish-to-toolkit behavior.
4. **AI-assisted builder** — optional workflow generation, expression help, documentation drafting, test explanation, and summarization using Ollama locally or optional OpenAI/Azure AI Foundry providers.

The first release should feel like a practical local audit analytics platform, not a generic automation demo.

---

# 2. Product goals

## 2.1 Primary goals

The app must allow an auditor or audit analytics developer to:

- Create an audit workflow from scratch or from a template.
- Import data from files, sample datasets, local tables, APIs, or integrations.
- Build a visual workflow using nodes such as Import File, Add Columns, Edit Columns, Filter, Join, Append, Deduplicate, Pivot, Unpivot, Validate, Chart, Python, and Publish to Toolkit.
- Configure typed parameters such as thresholds, dates, booleans, enums, text values, and file inputs.
- Preview tabular data after each node.
- Run the workflow locally.
- Preserve execution history, parameters, input fingerprints, outputs, logs, and errors.
- Verify workflow versions through a tester/reviewer process.
- Activate a verified workflow version.
- Publish approved workflows as reusable audit tools/templates.
- Use a local LLM through Ollama by default, while optionally selecting OpenAI or Azure AI Foundry.

## 2.2 Secondary goals

The app should eventually support:

- Multi-user deployment.
- Role-based access control.
- Team review workflows.
- Remote worker execution.
- Shared template library.
- External integration marketplace.
- MCP server exposure so external AI tools can discover and run approved local tools.
- RAG over project documentation, prior audit workflows, run histories, and template descriptions.

---

# 3. Non-goals for MVP

The MVP must not attempt to recreate every feature from n8n, Make, Zapier, Activepieces, Windmill, Alteryx, or audit SaaS platforms.

The following are out of scope for MVP unless explicitly assigned:

- Large public connector marketplace.
- Enterprise SSO and full RBAC.
- Real-time multi-user collaborative editing.
- Cloud SaaS hosting.
- Mobile app.
- Full audit management system.
- Workpaper repository replacement.
- Permanent deletion of verified audit evidence.
- Unlimited custom shell command execution.
- Cloud LLM use by default.

---

# 4. Target users

## 4.1 Primary users

- Internal audit analytics developers.
- Technology auditors who want repeatable analytics workflows.
- Audit managers reviewing analytics logic and outputs.
- Auditors who need to run approved audit tests without writing code.

## 4.2 User skill levels

The product must support both:

- **Builder users** who understand data, formulas, and audit testing logic.
- **Runner users** who choose a verified workflow, provide parameters and input files, run it, and export results.

---

# 5. System architecture

## 5.1 Local-first architecture

The system runs locally by default. The default installation must not require cloud services.

Recommended local architecture:

```text
Desktop Shell / Browser UI
        |
        v
React + TypeScript UI
        |
        v
Local API Server
        |
        +--> Workflow metadata store
        +--> Dataset catalog
        +--> Execution history
        +--> Credential vault
        +--> LLM provider gateway
        |
        v
Execution Engine
        |
        +--> Tabular analytics runtime
        +--> Node runtime
        +--> Sandbox runtime
        +--> Local queue
        |
        v
Local file/cache storage
```

The app may be launched in one of three modes:

1. **Developer mode** — local web app through Node.js tooling.
2. **Local packaged mode** — Tauri desktop shell that starts or connects to the local backend.
3. **Optional server mode** — Docker Compose or similar profile for team or production-style deployment.

## 5.2 Recommended technology stack

| Layer | Preferred technology | Notes |
|---|---|---|
| Desktop shell | Tauri | Use after web MVP is stable. |
| Frontend | React + TypeScript | Use React Flow or equivalent for the canvas. |
| Canvas | React Flow | Node-and-edge editor with minimap, zoom, pan, handles, and inspector. |
| Server/API | TypeScript, Fastify or NestJS | Must expose local REST and streaming endpoints. |
| Workflow engine | TypeScript package | Shared schemas with UI and backend. |
| Tabular engine | DuckDB + Arrow/Parquet | Use for file import, joins, filters, pivots, and previews. |
| Local metadata DB | SQLite initially, PGLite or PostgreSQL optional | Use migrations from day one. |
| Queue | Local in-process or SQLite-backed queue for MVP; Redis/BullMQ adapter later | Keep queue interface abstract. |
| Python support | Isolated Python process | Never run arbitrary Python inside the main app process. |
| Secrets | Encrypted local vault + OS keychain where possible | Store references in workflow JSON, not raw secrets. |
| LLM local | Ollama | Default provider. |
| LLM cloud | OpenAI and Azure AI Foundry adapters | Optional, explicit user selection required. |
| Vector store | sqlite-vec, LanceDB, Chroma, or pgvector depending on deployment mode | Use an interface to avoid lock-in. |

---

# 6. Major modules

## 6.1 Workflow catalog

The workflow catalog lists all workflow tasks/tools with:

- Service or category tags.
- Name.
- Description.
- Verification status.
- Active version.
- Version published by.
- Version published date.
- Number of connected automations.
- Search, filters, sorting, and configurable columns.

## 6.2 Template library

The template library provides reusable audit workflows such as:

- Travel and Expense Testing.
- Payroll Ghost Employees.
- Payroll Inactivity and Salary Confirmation.
- Procure to Pay Analysis.
- Procure to Pay Duplicate and Suspicious Posting Test.
- Payments Remitted to Employees.
- User Access Review.
- Incident Assignment SLA Testing.

Templates must declare:

- Purpose.
- Risk addressed.
- Required input datasets.
- Parameters.
- Expected output datasets.
- Review requirements.
- Version source.

## 6.3 Workflow details

Each workflow has detail fields:

- Name.
- Description.
- Notes.
- Business case.
- Requirements and design considerations.
- Estimated cost savings per run.
- Estimated time savings per run.
- Type.
- Updated date.
- Active version.
- Source version.
- Verification status.
- Tester.
- Reviewer.
- Verified date.
- Recently published versions.

## 6.4 Workflow canvas

The workflow canvas supports:

- Nodes.
- Edges.
- Groups/sections.
- Sticky notes.
- Tool palette.
- Parameters panel.
- Data preview panel.
- Run controls.
- Publish controls.
- Minimap.
- Zoom and pan.

Required MVP node categories:

| Category | Nodes |
|---|---|
| Import | Import File, Import from API, Import Sample Data, New Table |
| Clean | Find Replace, Text to Columns, Parse JSON, Sample, Validate |
| Merge | Join, Append |
| Transform | Add Columns, Edit Columns, Overwrite Columns, Select Columns, Filter, Sort, Deduplicate, Pivot, Unpivot |
| Code | Python |
| Visualize | Chart |
| Governance | Publish to Toolkit |
| AI | LLM Chat, Explain Expression, Generate Test Logic |

## 6.5 Execution engine

The execution engine must:

- Load a workflow version.
- Validate the graph.
- Resolve parameters.
- Load input datasets.
- Execute nodes in graph order.
- Cache node outputs for preview and reruns.
- Persist execution status and logs.
- Stream node status to the UI.
- Stop safely on errors.
- Preserve intermediate outputs when useful for debugging.

The MVP can start with directed acyclic graphs. Cycles and advanced looping can be added later.

## 6.6 Tabular analytics runtime

The tabular runtime must support:

- CSV, Excel, JSON, and Parquet input where feasible.
- Column type inference.
- Column rename and type conversion.
- Filtering with expressions and parameter references.
- Derived columns.
- Joins.
- Appends/unions.
- Deduplication.
- Pivot/unpivot.
- Validation table generation.
- Sample previews.
- Export to CSV/Excel/Parquet.

DuckDB should be used for local analytic operations unless a decision record changes this.

## 6.7 Versioning and verification

Workflow changes create draft versions. A version becomes active only after verification.

Version states:

- `draft`
- `ready_for_review`
- `verified`
- `rejected`
- `active`
- `archived`

Verification must capture:

- Tester.
- Reviewer.
- Testing performed.
- Parameters used.
- Sample input fingerprints.
- Sample output fingerprints.
- Pass/fail status.
- Review comments.
- Amend review comments.
- Timestamp.

## 6.8 Evidence retention

Each execution must retain enough information to support audit reproducibility:

- Workflow ID and version ID.
- Input file names and hashes.
- Parameter values.
- Node output summaries.
- Final output location and hash.
- Logs.
- Errors.
- User who ran the workflow.
- Run timestamp.
- LLM provider used, if any.
- LLM prompt and response metadata when safe and allowed.

Do not store raw secrets in evidence records.

## 6.9 LLM provider gateway

The LLM gateway must hide provider-specific details behind a stable interface.

Required provider types:

- `ollama`
- `openai`
- `azure_foundry`
- `mock`

Required capabilities:

- Chat completion.
- Streaming chat.
- Structured JSON output.
- Embeddings.
- Tool/function calling where supported.
- Provider health check.
- Token/cost/latency logging where available.

Default provider is Ollama.

Cloud providers may only be used when explicitly configured and selected.

---

# 7. Core domain model

## 7.1 Entity overview

| Entity | Purpose |
|---|---|
| `Workspace` | Local project/workspace boundary. |
| `User` | Local user identity. MVP may use one local user. |
| `Workflow` | Stable identity for an audit workflow/tool. |
| `WorkflowVersion` | Immutable workflow definition snapshot. |
| `WorkflowNode` | Node configuration inside a version. |
| `WorkflowEdge` | Directed connection between nodes. |
| `WorkflowParameter` | Typed parameter for a workflow version. |
| `Template` | Reusable workflow blueprint. |
| `Dataset` | Logical dataset such as an imported file or generated table. |
| `DatasetVersion` | Physical snapshot of dataset contents and schema. |
| `Credential` | Encrypted connection secret. |
| `Execution` | One run of a workflow version. |
| `NodeExecution` | Runtime status/output for one node in an execution. |
| `VerificationReview` | Tester/reviewer assessment of a workflow version. |
| `PublishedTool` | Verified workflow exposed as a reusable toolkit item. |
| `DecisionLog` | Important architecture/product decisions. |

## 7.2 Workflow

Required fields:

- `id`
- `workspaceId`
- `name`
- `description`
- `category`
- `serviceTags`
- `type`
- `status`
- `activeVersionId`
- `createdAt`
- `updatedAt`
- `deletedAt`

## 7.3 WorkflowVersion

Required fields:

- `id`
- `workflowId`
- `versionNumber`
- `status`
- `sourceVersionId`
- `nodesJson`
- `edgesJson`
- `parametersJson`
- `notes`
- `businessCase`
- `requirementsAndDesignConsiderations`
- `estimatedCostSavingsPerRun`
- `estimatedTimeSavingsPerRun`
- `createdBy`
- `createdAt`
- `publishedBy`
- `publishedAt`

## 7.4 Execution

Required fields:

- `id`
- `workflowId`
- `workflowVersionId`
- `status`
- `startedAt`
- `finishedAt`
- `triggerType`
- `parametersJson`
- `inputDatasetVersionIds`
- `outputDatasetVersionIds`
- `errorSummary`
- `createdBy`

Valid statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `suspended`

## 7.5 NodeExecution

Required fields:

- `id`
- `executionId`
- `nodeId`
- `status`
- `startedAt`
- `finishedAt`
- `inputSummaryJson`
- `outputSummaryJson`
- `outputDatasetVersionId`
- `errorJson`
- `logsJson`

---

# 8. Global product rules

## 8.1 Local-first rules

- The app must work without Internet access for local workflows.
- Cloud LLMs are opt-in only.
- Local data must not be uploaded to external services by default.
- Workflows must show when a node requires Internet access.

## 8.2 Audit governance rules

- Executed workflow versions are immutable.
- Verified versions are immutable.
- Active versions can only be changed through activation of another verified version.
- Deleting a workflow must not delete past evidence by default.
- Published tools must always point to a verified version.
- Reviewer sign-off must be recorded with timestamp and reviewer identity.

## 8.3 Data handling rules

- Imported files must be fingerprinted with a hash.
- Output datasets must be reproducible from workflow version + parameters + inputs unless external API calls are involved.
- External API responses must record enough metadata to support troubleshooting.
- Data previews must not mutate data.
- Transform nodes must produce new dataset versions rather than mutating prior node outputs in place.

## 8.4 Security rules

- Never store raw credentials in workflow JSON.
- Never log secrets.
- Python/custom code must run outside the main process.
- Shell command execution is disabled by default.
- HTTP/API nodes must include SSRF protections before any network exposure.
- Local services must bind to localhost by default.
- Any remote access mode must require authentication and TLS.

## 8.5 LLM rules

- Ollama is the default LLM provider.
- Cloud LLM use must be explicit per workspace, workflow, or run.
- LLM-generated workflow changes must be reviewed before saving.
- LLM-generated code must be treated as untrusted.
- LLM outputs that affect execution must pass schema validation.
- Sensitive data should be redacted before being sent to any cloud model.

---

# 9. Repository structure

Recommended repository structure:

```text
project-root/
  project.md
  gates.md
  decisions.md
  glossary.md
  features/
    task-creation.md
    task-deletion.md
  apps/
    web/
    desktop/
    api/
    worker/
  packages/
    domain/
    workflow-schema/
    workflow-engine/
    node-sdk/
    tabular-engine/
    llm-gateway/
    credential-vault/
    evidence/
    ui-components/
    test-fixtures/
  templates/
    travel-expense-testing/
    payroll-ghost-employees/
    procure-to-pay-duplicates/
  docs/
    architecture/
    security/
    deployment/
  migrations/
  scripts/
```

Rules:

- Shared types live in `packages/domain` or `packages/workflow-schema`.
- Runtime node definitions live in `packages/node-sdk` or node-specific packages.
- UI components must not directly call database code.
- The engine must not depend on React.
- The LLM gateway must not depend on UI code.
- Evidence generation must be deterministic and testable.

---

# 10. MVP feature set

The MVP is complete when a user can:

1. Create a workflow from blank or template.
2. Add/import a file dataset.
3. Add at least five transform nodes: Add Columns, Filter, Join, Deduplicate, Validate.
4. Configure typed parameters.
5. Preview data after each node.
6. Run the workflow locally.
7. View run history and node-level results.
8. Create a new workflow version.
9. Submit a version for verification.
10. Mark a version verified.
11. Activate a verified version.
12. Publish a verified version to the toolkit.
13. Use Ollama for at least one AI-assist action.
14. Export final results and an evidence summary.

---

# 11. Testing strategy

Required test types:

- Unit tests for workflow schema validation.
- Unit tests for expression parsing.
- Unit tests for parameter resolution.
- Unit tests for each tabular transform node.
- Integration tests for workflow execution.
- Integration tests for evidence generation.
- E2E tests for create, run, verify, activate, and publish flows.
- Security tests for secret redaction.
- Mock LLM provider tests.

Use small, deterministic test datasets for repeatability.

---

# 12. First answer critique

The early architecture research was strong on workflow orchestration but underweighted audit-specific behavior. The screenshots from the audit-focused app show that this project needs more than an n8n-style engine. It needs audit metadata, tabular analytics, verification, reviewer sign-off, active version governance, template cloning, and evidence retention. This file corrects that by treating the product as a local audit analytics workflow platform, not just a generic automation clone.


## MVP feature files

See `features/README.md` for the current MVP feature index.
