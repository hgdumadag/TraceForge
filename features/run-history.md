# Feature Specification: Run History

## What this file is for

This file defines how workflow executions are recorded, displayed, searched, opened, rerun, and retained as audit evidence.

## When to read this file

Read this file when building or changing:

- Run History tab.
- Execution record storage.
- Execution detail page.
- Logs, parameters, inputs, outputs, and errors.
- Rerun behavior.
- Evidence retention policies.

## When not to read this file

Do not read this file for canvas editing, template library browsing, or version verification process unless run history feeds verification evidence.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Run history is audit evidence; do not delete it casually.
2. Store enough detail to reproduce or explain a run.
3. Keep input data references and fingerprints.
4. Redact secrets from logs.
5. Add tests for history persistence, filters, evidence fields, and rerun behavior.

---

# 1. Feature summary

Run history records every workflow execution, including draft test runs and active production runs. It supports audit traceability and reviewer verification.

# 2. MVP user stories

## 2.1 View run history

Acceptance criteria:

- Workflow detail page has Run History tab.
- Run list shows execution status, version, started time, finished time, duration, runner, and summary row counts.
- User can filter by status, version, date, and runner.

## 2.2 Open execution detail

Acceptance criteria:

- Execution detail shows workflow version snapshot, parameter values, input dataset versions, output dataset versions, logs, node statuses, and errors.
- User can preview output datasets from execution detail.
- Secrets and credential values are never displayed.

## 2.3 Rerun execution

Acceptance criteria:

- User can rerun using same version and parameter values where inputs still exist.
- If input datasets are missing, rerun is blocked with clear message.
- Rerun creates a new execution record linked to the original.

# 3. Evidence fields

Each run should store:

- Execution ID.
- Workflow ID.
- Workflow version ID.
- Version status at run time.
- Runner/local user.
- Start/end timestamps.
- Status.
- Runtime parameter values.
- Input dataset version IDs and fingerprints.
- Output dataset version IDs.
- Node execution records.
- Logs/errors with redaction.
- App version/build if available.

# 4. Retention rules

- Execution records are retained by default.
- Draft test runs may be clearable only if not attached to verification evidence.
- Verified/active run evidence must not be hard-deleted by default.
- Cleanup policies must be explicit and auditable.

# 5. Data model touchpoints

- `ExecutionRecord`
- `NodeExecutionRecord`
- `ExecutionLogEntry`
- `WorkflowRunParameterValue`
- `DatasetVersion`
- `EvidencePackage`

# 6. Tests

Minimum tests:

- Execution record is created on run.
- Parameters and input fingerprints are stored.
- Run History tab lists executions.
- Execution detail shows node statuses.
- Rerun creates new execution linked to original.
- Logs redact credentials.
- Verified evidence cannot be deleted through normal cleanup.
