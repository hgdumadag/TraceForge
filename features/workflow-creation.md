# Feature Specification: Workflow Creation

## What this file is for

This file defines how users create a new audit workflow, either blank, duplicated from an existing workflow, cloned from a template, or drafted with AI assistance.

## When to read this file

Read this file when building or changing:

- `+ Workflow` behavior.
- Blank workflow creation.
- Clone-from-template behavior.
- Duplicate workflow behavior.
- First draft version creation.
- Initial metadata, parameters, nodes, and edges.
- AI-assisted creation entry points.

## When not to read this file

Do not read this file for template library browsing details, execution internals, or verification review behavior after creation.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Every newly created workflow must have exactly one initial draft version.
2. Do not activate a workflow at creation time unless the workflow is cloned from an already verified template and activation is explicitly allowed by the selected path.
3. Preserve template source metadata when cloning from a template.
4. Validate workflow JSON before saving.
5. Never call a cloud LLM unless the user selected that provider for this action.

---

# 1. Feature summary

Users must be able to create audit workflows in four MVP paths:

1. Blank workflow.
2. Clone from audit template.
3. Duplicate existing workflow.
4. AI-assisted draft, using the selected LLM provider.

The creation result is always:

- One `Workflow` record.
- One `WorkflowVersion` record with status `draft`.
- Initial metadata.
- Initial parameter definitions.
- Initial canvas nodes and edges, if applicable.

# 2. MVP user stories

## 2.1 Create blank workflow

Acceptance criteria:

- User can select `Blank workflow`.
- User must provide a name before saving.
- Description is optional but recommended.
- App creates an empty canvas with a draft version.
- Workflow appears in catalog with status Draft/Unverified.

## 2.2 Clone from template

Acceptance criteria:

- User can open template library from the creation flow.
- User can preview template name, category, purpose, required inputs, default parameters, and expected outputs.
- User can confirm name and details before cloning.
- Cloned workflow retains `templateSourceId`, `templateSourceVersionId`, and default parameters.
- Cloned workflow starts as draft unless template policy says it may create a verified copy.

## 2.3 Duplicate existing workflow

Acceptance criteria:

- User can duplicate a workflow from catalog or detail page.
- Duplicate receives a new workflow ID and new draft version.
- Duplicate copies nodes, edges, parameters, notes, and metadata.
- Duplicate does not copy execution history, verification records, or active status.
- Name defaults to `Copy of <original name>` and can be changed.

## 2.4 AI-assisted draft

Acceptance criteria:

- User can describe the audit test goal.
- App shows selected LLM provider and whether data will leave the device.
- Ollama/local provider is default when available.
- AI proposal is previewed before saving.
- AI output must pass schema validation before workflow is created.
- Failed AI generation does not create partial workflows unless user explicitly saves draft.

# 3. Required fields

Minimum workflow fields:

| Field | Required | Notes |
|---|---:|---|
| Name | Yes | Unique within local workspace where practical. |
| Description | No | Strongly recommended for audit clarity. |
| Service/category | No | Example: Payroll, Procure to Pay, T&E, IT Controls. |
| Type | No | Example: Audit, Automation, Data Prep, Validation. |
| Owner | No | Defaults to local profile/user. |
| Template source | No | Required if cloned from template. |

# 4. Validation rules

- Name cannot be blank.
- Name length must be reasonable, default max 150 characters.
- Workflow JSON must include valid `nodes` and `edges` arrays.
- Edges cannot reference missing nodes.
- Parameter keys must be unique within the workflow version.
- Draft version must be editable.

# 5. Data model touchpoints

- `Workflow`
- `WorkflowVersion`
- `WorkflowMetadata`
- `WorkflowParameterDefinition`
- `NodeDefinition`
- `EdgeDefinition`
- `TemplateSourceReference`

# 6. Tests

Minimum tests:

- Blank creation creates workflow and one draft version.
- Missing name blocks save.
- Clone copies template nodes, parameters, and metadata.
- Duplicate does not copy execution history.
- AI-assisted creation validates schema before saving.
- Cloud provider warning appears before cloud LLM use.
