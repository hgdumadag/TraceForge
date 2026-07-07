# Feature Specification: Publish to Toolkit

## What this file is for

This file defines how verified workflow versions become reusable approved tools/templates in the local toolkit.

## When to read this file

Read this file when building or changing:

- Publish to Toolkit node/action.
- Toolkit publishing flow.
- Published tool metadata.
- Unpublish behavior.
- Template/tool reuse after publishing.

## When not to read this file

Do not read this file for ordinary workflow creation, run execution, or verification details except where publishing requires verified status.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Only verified versions may be published to toolkit.
2. Publishing must reference an immutable workflow version.
3. Publishing does not copy execution history.
4. Unpublishing should not delete the source workflow/version.
5. Add tests for verified-only publish and toolkit clone behavior.

---

# 1. Feature summary

Publishing turns a verified workflow version into a reusable approved audit tool. Users can later clone or run the published tool without rebuilding the workflow.

# 2. MVP user stories

## 2.1 Publish verified version

Acceptance criteria:

- User can publish only a verified version.
- Publish requires name, category, description, required inputs, parameters, and expected outputs.
- Published tool records source workflow ID and version ID.
- Published tool appears in the template/toolkit library.

## 2.2 Block unverified publish

Acceptance criteria:

- Draft or In Review versions cannot be published.
- UI explains that verification is required.
- No partial PublishedTool record is created.

## 2.3 Clone from published tool

Acceptance criteria:

- User can clone a published tool into a new workflow draft.
- Clone preserves source toolkit reference.
- Clone can be edited without mutating published source.

## 2.4 Unpublish tool

Acceptance criteria:

- User can unpublish a tool with confirmation.
- Source workflow/version remains intact.
- Existing workflows cloned from the tool are not deleted.
- Unpublish action is logged.

# 3. Published tool metadata

Minimum fields:

- Published tool ID.
- Display name.
- Category/service.
- Description.
- Risk statement.
- Required inputs.
- Parameters.
- Expected outputs.
- Source workflow ID.
- Source workflow version ID.
- Published by.
- Published at.
- Status: Published, Unpublished, Deprecated.

# 4. Data model touchpoints

- `PublishedTool`
- `PublishedToolVersion`
- `WorkflowVersion`
- `VerificationRecord`
- `TemplateCloneRecord`
- `AuditLogEntry`

# 5. Tests

Minimum tests:

- Verified version can publish.
- Draft version cannot publish.
- Published tool appears in toolkit/template library.
- Clone from published tool creates draft workflow.
- Unpublish hides tool but preserves source workflow/version.
- Publish action records actor and timestamp.
