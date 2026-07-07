# Feature Specification: Workflow Parameters

## What this file is for

This file defines workflow-level parameters such as thresholds, dates, booleans, file inputs, and runtime options.

## When to read this file

Read this file when building or changing:

- Parameter definitions.
- Parameter panel on the canvas.
- Default values and runtime overrides.
- File parameters.
- Parameter references in expressions.
- Parameter evidence captured during runs.

## When not to read this file

Do not read this file for expression parser details, node-specific config, or LLM provider internals unless they involve parameter generation.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Parameters make workflows reusable; do not hard-code audit thresholds in node logic.
2. Parameter values used during a run must be captured in run history.
3. Parameter definitions belong to workflow versions.
4. Parameter overrides must not mutate verified versions.
5. Validate parameter types before execution.

---

# 1. Feature summary

Parameters allow one workflow design to be reused across audits by changing values like:

- Receipt Threshold = 75.
- Timeliness Threshold = 60.
- Multiple Approver Threshold = 1000.
- Employee Expense Listing = selected input file/table.
- Review Period Start / End.

# 2. Parameter types

MVP types:

| Type | Example |
|---|---|
| Text | `Payroll` |
| Integer | `60` |
| Decimal | `1000.00` |
| Boolean | `true` |
| Date | `2026-01-01` |
| Enum | `High`, `Medium`, `Low` |
| File/Dataset | `Employee Expense Listing.xlsx` |

# 3. MVP user stories

## 3.1 Define parameter

Acceptance criteria:

- Builder can add parameter with key, label, type, default value, description, and required flag.
- Parameter key is stable and used in expressions.
- Parameter label is user-facing and can contain spaces.
- Duplicate parameter keys are blocked.

## 3.2 Edit parameter in draft

Acceptance criteria:

- Draft version parameters can be edited.
- Verified/active version parameter definitions are immutable.
- Runtime values may be overridden without changing the version definition.

## 3.3 Use parameter in expression

Acceptance criteria:

- Expressions can reference parameters with `{param!key}`.
- Missing parameters produce validation errors.
- Type mismatch produces validation errors.

## 3.4 Runtime parameter entry

Acceptance criteria:

- Before run, user can review required parameters.
- Required missing parameters block run.
- Runtime parameter values are stored with the execution record.
- File/dataset parameters bind to selected dataset versions.

# 4. Data model touchpoints

- `WorkflowParameterDefinition`
- `WorkflowRunParameterValue`
- `WorkflowVersion`
- `ExecutionRecord`
- `DatasetVersion`

# 5. Validation rules

- Parameter key format: lowercase letters, numbers, and underscores; starts with letter.
- Label cannot be blank.
- Required parameter must have value at run time.
- Default value must match type.
- Enum parameter must define allowed values.
- File/dataset parameter must reference an available dataset when run.

# 6. Tests

Minimum tests:

- Add integer parameter with default value.
- Duplicate keys are blocked.
- Required missing runtime parameter blocks run.
- Parameter values are captured in run history.
- Verified version parameter definitions cannot be edited.
- File parameter binds to dataset version.
