# Feature Specification: Workflow / Audit Task Creation

## What this file is for

This file defines the behavior, rules, and tests for creating a new workflow/audit test task.

In this project, a “task” means a reusable audit workflow or audit analytics test, such as Travel & Expense Testing, Payroll Ghost Employees, User Access Review, or Procure to Pay Duplicate Testing.

## When to read this file

Read this file only when building or changing behavior related to:

- Creating a workflow/audit task from scratch.
- Cloning a workflow/audit task from a template.
- Creating the first draft version.
- Defining task metadata.
- Defining task parameters.
- Creating initial canvas nodes.
- AI-assisted workflow creation.

## When not to read this file

Do not read this file for:

- Running workflows.
- Deleting workflows.
- Node execution internals.
- Reviewer verification logic unless creation behavior is involved.
- LLM provider implementation details unrelated to creation.

## Related files

- `../project.md` — global product and architecture rules.
- `task-deletion.md` — delete/archive behavior.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.

## Agent instructions

When implementing this feature:

1. Preserve the distinction between `Workflow` and `WorkflowVersion`.
2. New workflows must start with a draft version.
3. Do not make newly created workflows active unless explicitly created from a verified template and the activation rule allows it.
4. Do not call cloud LLM providers during creation unless the user explicitly selected one.
5. Use schema validation before saving any workflow or version.
6. Add or update tests when behavior changes.

---

# 1. Feature summary

Users must be able to create a new audit workflow/task in three ways:

1. **Blank workflow** — user starts with an empty canvas.
2. **Clone from template** — user selects a template from a categorized template library.
3. **AI-assisted draft** — user describes the audit test and the app proposes a draft workflow using the selected LLM provider.

The output of creation is always:

- One `Workflow` record.
- One `WorkflowVersion` record with status `draft`.
- Zero or more initial nodes.
- Zero or more initial edges.
- Zero or more typed parameters.
- Optional template source metadata.

---

# 2. User stories

## 2.1 Create blank workflow

As an audit analytics builder, I want to create a blank workflow so I can design a new audit test from scratch.

Acceptance criteria:

- User can click `+ Workflow` or equivalent.
- User can choose `Blank workflow`.
- User must provide a workflow name.
- User may provide description, category, service tags, type, business case, and design considerations.
- System creates a workflow with one draft version.
- Canvas opens after successful creation.
- Draft version contains no executable nodes unless the user selected a starter node option.

## 2.2 Clone from template

As an auditor, I want to clone a prebuilt audit template so I can start from an approved pattern.

Acceptance criteria:

- User can open `Clone Template`.
- User can search, sort, and filter templates.
- Templates display category tags such as Payroll, Procure to Pay, IT Controls, AWS, or Travel & Expense.
- Template cards show name, short purpose, and source/provider where available.
- User can select a template and continue to confirm details.
- System copies template nodes, edges, parameters, metadata, and documentation into a new draft version.
- Source template ID and version are recorded.
- Cloning a template never mutates the source template.

## 2.3 Create with AI assistance

As an audit analytics builder, I want the app to draft a workflow from my description so I can accelerate design.

Acceptance criteria:

- User can enter a prompt describing the audit objective.
- User can choose provider: Ollama, OpenAI, Azure AI Foundry, or mock provider.
- Default provider is Ollama.
- App sends only the minimum needed context to the selected provider.
- App validates the generated workflow JSON before showing it.
- User must review and accept the generated draft before it is saved.
- If generated output fails validation, the app shows a safe error and does not save partial invalid workflow data.
- Cloud provider use is logged as metadata.

---

# 3. Creation flow

## 3.1 Blank creation flow

```text
User clicks + Workflow
  -> Selects Blank Workflow
  -> Enters required metadata
  -> System validates metadata
  -> System creates Workflow
  -> System creates WorkflowVersion versionNumber = 1, status = draft
  -> System opens canvas editor
```

## 3.2 Template clone flow

```text
User clicks Clone Template
  -> System shows template library
  -> User searches/filters/sorts
  -> User selects template
  -> User confirms details and parameters
  -> System validates template compatibility
  -> System creates Workflow
  -> System creates WorkflowVersion from template snapshot
  -> System records sourceTemplateId and sourceTemplateVersionId
  -> System opens canvas editor
```

## 3.3 AI-assisted creation flow

```text
User enters audit objective
  -> User selects LLM provider
  -> System builds safe prompt context
  -> LLM returns proposed workflow JSON
  -> System validates schema
  -> User reviews proposed canvas and metadata
  -> User accepts or rejects
  -> If accepted, system creates Workflow + draft WorkflowVersion
```

---

# 4. Required fields

## 4.1 Workflow fields

Required:

- `name`
- `workspaceId`
- `type`

Optional but recommended:

- `description`
- `category`
- `serviceTags`
- `businessCase`
- `requirementsAndDesignConsiderations`
- `estimatedCostSavingsPerRun`
- `estimatedTimeSavingsPerRun`

## 4.2 WorkflowVersion fields

Required:

- `workflowId`
- `versionNumber`
- `status = draft`
- `nodesJson`
- `edgesJson`
- `parametersJson`
- `createdBy`
- `createdAt`

## 4.3 Parameter fields

Each parameter must have:

- `id`
- `name`
- `key`
- `type`
- `required`
- `defaultValue` where appropriate

Supported MVP parameter types:

- `integer`
- `decimal`
- `text`
- `boolean`
- `date`
- `enum`
- `file`

---

# 5. Validation rules

## 5.1 Name rules

- Name is required.
- Name must be unique within the workspace unless the existing item is deleted/archived and the system supports reuse.
- Name must not be only whitespace.
- Name should be limited to 120 characters.

## 5.2 Workflow graph rules

- Nodes must have unique IDs.
- Edges must reference existing node IDs.
- A workflow version must pass schema validation before save.
- Draft versions may have disconnected nodes.
- Verified versions must not have invalid, orphaned, or missing required node configuration.

## 5.3 Template rules

- A template clone must copy the template snapshot, not reference live mutable template data.
- If a template references unavailable nodes, the app must warn the user before creation.
- Required template parameters must be present after clone.

## 5.4 AI-generated draft rules

- AI output must be parsed as structured JSON.
- AI output must pass workflow schema validation.
- AI-generated expressions must be treated as untrusted until validated.
- AI-generated Python code must be treated as untrusted and must not execute during creation.
- User must explicitly save accepted AI output.

---

# 6. UI behavior

## 6.1 Workflow creation entry points

Minimum entry points:

- `+ Workflow` button from workflow catalog.
- `Clone Template` button from workflow catalog.
- Optional `Create with AI` button from creation modal.

## 6.2 Template library modal

Template library must support:

- Search.
- Sort by name.
- Filter by category/service tag.
- Template cards.
- Continue button.
- Cancel button.

Template card displays:

- Template name.
- Short purpose.
- Category tag.
- Source/provider badge if applicable.

## 6.3 Creation details form

The form must include:

- Name.
- Description.
- Category.
- Service tags.
- Business case.
- Requirements and design considerations.
- Estimated savings fields.
- Initial parameters if created from template.

## 6.4 Success behavior

After successful creation:

- Show the workflow canvas.
- Show draft version label.
- Show unsaved changes status when user edits.
- Do not mark as verified or active by default.

## 6.5 Error behavior

If creation fails:

- Do not create partial records unless transaction rollback is impossible.
- Show clear error message.
- Preserve user-entered form data where safe.
- Log technical error details locally.

---

# 7. Permissions and safety

MVP may be single-user. For future multi-user mode:

- Only users with builder role can create workflows.
- Only users with template manager role can create or publish templates.
- AI-assisted creation may be restricted by workspace policy.
- Cloud LLM providers may be disabled by workspace policy.

---

# 8. Data and evidence implications

Creation itself does not create audit evidence.

Evidence starts when a workflow is executed or verified.

However, creation must record:

- Created by.
- Created at.
- Source template, if any.
- LLM provider used, if any.
- AI generation metadata, if any.

Do not store raw API keys, local file contents, or unnecessary prompt data in creation metadata.

---

# 9. Test scenarios

## 9.1 Unit tests

- Creates valid workflow object from minimum required input.
- Rejects blank name.
- Rejects duplicate name in same workspace.
- Allows same name in different workspace if workspace support exists.
- Creates draft version with version number 1.
- Validates parameter schema.
- Rejects invalid parameter type.
- Rejects edge referencing missing node.
- Clones template without mutating original template.
- Records source template metadata.
- Validates AI-generated workflow JSON.
- Rejects invalid AI-generated workflow JSON.

## 9.2 Integration tests

- Create blank workflow and reload from database.
- Clone template and open canvas.
- Create AI-assisted workflow using mock provider.
- Save workflow with initial Import File and Filter nodes.
- Verify that workflow is not active by default.

## 9.3 E2E tests

- User creates blank workflow from catalog.
- User clones Travel & Expense template.
- User filters templates by Payroll and clones Payroll template.
- User attempts creation with duplicate name and receives validation error.
- User generates AI draft, reviews it, accepts it, and lands on canvas.

## 9.4 Security tests

- Cloud LLM provider is not called when Ollama/local provider is selected.
- Cloud LLM provider is not called when cloud providers are disabled.
- AI prompt does not include credential values.
- Template clone does not copy raw credential secrets into workflow JSON.

---

# 10. Edge cases

| Case | Expected behavior |
|---|---|
| User closes creation modal with unsaved data | Confirm if meaningful data was entered. |
| Template has unavailable node type | Warn and prevent creation unless user explicitly creates as incomplete draft. |
| AI provider unavailable | Show provider error and allow user to create manually. |
| AI output partially valid | Do not save automatically; show validation issues. |
| Duplicate parameter keys | Block save. |
| Invalid default parameter value | Block save. |
| Very large template | Show loading state and avoid blocking UI. |
| App offline | Blank and template creation should work if templates are local. Cloud AI creation unavailable. |

---

# 11. Definition of done for this feature

This feature is done only when:

- Blank workflow creation works.
- Template clone creation works.
- AI-assisted creation works with mock provider and at least one real local provider path.
- New workflows start as draft.
- Schema validation protects stored data.
- Tests listed above pass or are explicitly deferred in `decisions.md`.
- Documentation and screenshots are updated if UI changed.
