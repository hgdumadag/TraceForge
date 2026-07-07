# Feature Specification: Workflow Catalog

## What this file is for

This file defines the workflow catalog: the screen that lists audit workflows, shows status and metadata, and lets users find, open, clone, archive, or manage workflows.

## When to read this file

Read this file when building or changing:

- The workflow list page.
- Search, filters, sorting, and managed columns.
- Workflow status badges such as Draft, Verified, Active, Archived.
- Active version and published-version metadata shown in the catalog.
- The `+ Workflow` and `Clone Template` entry points.

## When not to read this file

Do not read this file for canvas internals, node execution, LLM provider logic, or verification workflow details beyond status display.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Keep the catalog fast and readable even when there are hundreds of workflows.
2. Do not trigger workflow execution from catalog except through explicit user action.
3. Do not show archived workflows by default.
4. Preserve audit status labels exactly; do not replace them with casual synonyms.
5. Add tests for filters, sort order, status display, and archive visibility.

---

# 1. Feature summary

The workflow catalog is the user's starting point. It displays reusable audit workflows such as Travel & Expense Testing, Payroll Ghost Employees, Procure to Pay Duplicate Testing, User Access Review, and similar audit analytics tests.

The catalog must answer:

- What workflows exist?
- Which version is active?
- Is the workflow verified?
- Who published or verified it?
- How many automations or toolkit references use it?
- Which service/category does it belong to?

# 2. MVP user stories

## 2.1 View workflows

As an audit analytics user, I want to view all non-archived workflows so I can open the one I need.

Acceptance criteria:

- Catalog shows workflow name, service/category, description summary, verification status, active version, version published by, version published date, and automations connected.
- Workflow name is clickable and opens the workflow detail page.
- Empty state explains how to create or clone a workflow.
- Archived workflows are hidden unless the Archived filter is enabled.

## 2.2 Search and filter workflows

As a user, I want to search and filter workflows so I can quickly find relevant audit tests.

Acceptance criteria:

- Search matches workflow name, description, service/category, tags, and template source.
- Filters support service/category, verification status, active/draft/archived status, owner, and updated date.
- Sorting supports name, updated date, verification status, and published date.
- Search and filter state is visible and can be cleared.

## 2.3 Manage visible columns

As a user, I want to choose which catalog columns are visible so I can focus on the metadata I care about.

Acceptance criteria:

- User can open `Manage Columns`.
- At minimum, these fields are available: Service, Name, Description, Verification, Active Version, Version Published By, Version Published, Automations Connected, Updated On, Owner.
- Column preferences persist locally per user/profile.

## 2.4 Catalog actions

As a user, I want quick actions from the catalog so I can create, clone, or manage workflows.

Acceptance criteria:

- `+ Workflow` opens workflow creation.
- `Clone Template` opens template library.
- Per-row actions include Open, Duplicate, Archive, and View Run History where allowed.
- Archive action follows archive-first deletion rules.

# 3. Data model touchpoints

- `Workflow`
- `WorkflowVersion`
- `VerificationRecord`
- `PublishedTool`
- `WorkflowAutomationLink`
- `CatalogColumnPreference`

# 4. UI rules

- Use compact badges for status.
- Use clear timestamps with local timezone.
- Long descriptions should wrap or truncate without hiding the row action.
- Clicking a workflow name opens detail; clicking status opens relevant status detail when implemented.

# 5. Error and empty states

- If metadata fails to load, show a non-destructive error and retry option.
- If the local database is unavailable, show a clear local storage error.
- If no workflows match filters, show `No workflows match your filters` and a clear-filters action.

# 6. Tests

Minimum tests:

- Catalog loads non-archived workflows.
- Search by name and description works.
- Filter by Verified returns only verified workflows.
- Archived workflows are hidden by default.
- Column preferences persist.
- `Clone Template` opens template library.
- Row click opens workflow detail.
