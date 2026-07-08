# Glossary

## What this file is for

This file defines common terms used in the project. It keeps language consistent across specs, code, tests, and agent instructions.

## When to read this file

Read this file when project terms are unclear or when naming domain objects, database tables, UI labels, or tests.

## When not to read this file

Do not read this file for implementation details unless terminology affects the change.

## Related files

- `features/README.md` — MVP feature index.
- `project.md` — global project context.
- `features/task-creation.md` — workflow/audit task creation.
- `features/task-deletion.md` — workflow/audit task deletion/archive.
- `gates.md` — completion checks.
- `decisions.md` — decision log.

## Agent instructions

Use these terms consistently. If a new term becomes important, add it here rather than inventing synonyms across files.

---

# Terms

## Active version

The verified workflow version currently approved for normal use. A workflow can have many versions but only one active version.

## Archive

A reversible action that hides a workflow from normal use while preserving versions, executions, reviews, and evidence.

## Audit evidence

Stored proof of what was run, when it was run, who ran it, what inputs and parameters were used, and what outputs were produced.

## Audit task

A reusable audit workflow or audit analytics test. In the feature files, “task” means this product object, not a personal to-do item.

## Builder user

A user who designs workflows, configures nodes, creates templates, and prepares audit tests.

## Canvas

The visual node-and-edge workspace where users build workflows.

## Cloud LLM

An LLM provider that sends prompts to an external service, such as OpenAI or Azure AI Foundry.

## Credential

A stored secret such as an API key, OAuth token, database password, or service account value. Credentials must be encrypted and referenced by ID, not stored directly inside workflow JSON.

## Dataset

A logical table or file-based data object used by a workflow. Examples include an employee expense listing, vendor master file, transaction listing, or validation output table.

## Dataset version

A specific immutable snapshot of a dataset, including schema, hash, source, and storage location.

## Draft version

An editable workflow version that has not yet been verified or activated.

## DuckDB

The preferred local analytics engine for tabular transformations such as filtering, joining, deduplicating, pivoting, and validating data.

## Edge

A directed connection between two workflow nodes.

## Execution

One run of a workflow version with specific parameters and inputs.

## Execution history

The list of past workflow runs, including status, timing, parameters, outputs, logs, and errors.

## Hard delete

Permanent deletion of records. This is allowed only for safe drafts with no executions, verified versions, published tools, or audit evidence.

## In review

The workflow version status while a submitted draft is being verified. The version is locked; the reviewer can pass it (verified), fail it (rejected), or send it back to draft with amendment comments. Canonical machine value: `in_review` (ADR-013).

## LLM gateway

The provider-agnostic service that routes AI requests to Ollama, OpenAI, Azure AI Foundry, or a mock provider.

## Local-first

The system works locally by default. Data stays on the user’s computer unless the user explicitly configures and selects a remote service.

## Node

A workflow step. Examples: Import File, Add Columns, Filter, Join, Validate, Python, Chart, Publish to Toolkit.

## Node execution

The runtime record of a specific node during a specific workflow execution.

## Ollama

The default local LLM runtime for this project.

## Parameter

A typed value that can be reused inside workflow logic, such as receipt threshold, timeliness threshold, date cutoff, or input file.

## Publish to Toolkit

The action that makes a verified workflow version available as a reusable approved tool/template.

## Reviewer

A person who reviews and approves or rejects a workflow version after testing.

## Runner user

A user who runs an approved workflow by providing inputs and parameters, without necessarily editing the workflow logic.

## Rejected version

A workflow version that failed verification. It cannot be activated or published; a new draft must be created to continue work.

## Soft delete

Another name for archive. It removes an item from normal use without physically deleting audit-relevant records.

## Superseded version

A former active version replaced when a newer verified version was activated. It stays immutable and its run history and evidence remain accessible (ADR-013).

## Template

A reusable workflow blueprint, often tied to a specific audit area such as Payroll, Procure to Pay, Travel & Expense, IT Controls, or User Access Review.

## Tester

A person who performs sample runs and validates a workflow version before reviewer approval.

## Verification

The process of testing and reviewing a workflow version before it can become active or published.

## Workflow

The stable identity of an audit automation or analytics task. A workflow contains one or more versions.

## Workflow version

An immutable snapshot of workflow nodes, edges, parameters, and documentation at a point in time.

## Workspace

A local project boundary containing workflows, templates, datasets, credentials, and settings.
