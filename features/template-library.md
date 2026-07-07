# Feature Specification: Template Library

## What this file is for

This file defines the audit template library used to clone reusable audit workflow designs into editable workflows.

## When to read this file

Read this file when building or changing:

- The `Clone Template` modal or page.
- Template categories, tags, and search.
- Template preview and confirm-details step.
- Built-in audit templates.
- Template versioning and source metadata.

## When not to read this file

Do not read this file for workflow execution, canvas editing after clone, or publishing workflows back into the toolkit.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Templates are source material, not execution history.
2. Cloning a template creates a new workflow and draft version.
3. Preserve template lineage for traceability.
4. Do not mutate a built-in template when a user edits a cloned workflow.
5. Keep templates understandable to auditors, not only developers.

---

# 1. Feature summary

The template library provides audit-ready starting points such as:

- Travel & Expense Testing.
- Payroll Ghost Employees, Analysis, and Duplicates.
- Payroll Inactivity and Salary Confirmation.
- Procure to Pay Analysis.
- Procure to Pay Duplicate and Suspicious Posting Test.
- Payments Remitted to Employees.
- User Access Review.
- IT Controls / AWS tests.

# 2. MVP user stories

## 2.1 Browse templates

Acceptance criteria:

- User can open template library from catalog or workflow creation.
- Templates show name, description, category, tags, source, and required inputs.
- Templates can be searched and filtered by category/tag.
- Empty state appears when no templates match filters.

## 2.2 Preview template details

Acceptance criteria:

- User can view template purpose, risk addressed, required input tables/files, default parameters, output tables, and notes.
- Preview identifies whether the template contains Python/custom code.
- Preview identifies whether the template requires credentials or external integrations.

## 2.3 Clone template

Acceptance criteria:

- User selects a template and continues to confirmation.
- User can rename the resulting workflow.
- App creates a workflow with draft version.
- Template lineage is stored.
- Parameters and required inputs are created with default values.

# 3. Template schema

Minimum fields:

| Field | Required | Notes |
|---|---:|---|
| `id` | Yes | Stable template ID. |
| `version` | Yes | Template version number. |
| `name` | Yes | User-facing name. |
| `description` | Yes | Short explanation. |
| `category` | Yes | Payroll, P2P, T&E, IT Controls, etc. |
| `tags` | No | Search/filter metadata. |
| `riskStatement` | No | Audit risk addressed. |
| `requiredInputs` | Yes | Files/tables/API inputs. |
| `parameters` | No | Thresholds and options. |
| `nodes` | Yes | Initial canvas nodes. |
| `edges` | Yes | Initial canvas edges. |
| `expectedOutputs` | No | Output tables/reports. |
| `containsCustomCode` | Yes | Boolean. |
| `requiresCredential` | Yes | Boolean. |

# 4. Built-in MVP templates

Minimum built-in templates should include:

1. Blank Audit Workflow.
2. Travel & Expense Testing.
3. Payroll Duplicate Employees.
4. Procure to Pay Duplicate Payments.
5. User Access Review.

Each built-in template must have sample data or clear required input definitions so the workflow can be tested locally.

# 5. Data model touchpoints

- `Template`
- `TemplateVersion`
- `TemplateInputDefinition`
- `TemplateParameterDefinition`
- `TemplateCloneRecord`
- `Workflow`
- `WorkflowVersion`

# 6. Tests

Minimum tests:

- Template list loads built-in templates.
- Search and category filters work.
- Preview shows required inputs and parameters.
- Clone creates workflow and draft version.
- Editing cloned workflow does not modify template.
- Template lineage is stored.
