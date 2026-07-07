# Feature Specification: Workflow Versioning

## What this file is for

This file defines draft, verified, active, and archived workflow versions, including immutability rules and activation behavior.

## When to read this file

Read this file when building or changing:

- Versioning tab.
- Draft version creation/editing.
- Version status transitions.
- Active version activation.
- Immutable version snapshots.
- Version source metadata.

## When not to read this file

Do not read this file for node execution internals or reviewer workflow details except where verification affects version status.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Workflow versions are the unit of execution and verification.
2. Executed, verified, and active versions must be immutable.
3. New changes should create or update a draft version, not mutate active versions.
4. Only verified versions may become active.
5. Add tests for status transitions and immutability.

---

# 1. Feature summary

A workflow can have multiple versions. Users edit drafts, verify versions, and activate a verified version for normal use.

# 2. Version statuses

| Status | Meaning | Editable? |
|---|---|---:|
| Draft | Work in progress | Yes |
| In Review | Submitted for verification | Limited |
| Verified | Passed tester/reviewer checks | No |
| Active | Verified version approved for normal use | No |
| Superseded | Former active/verified version replaced by newer active version | No |
| Archived | Hidden from normal use | No, unless restored to draft by explicit flow |

# 3. MVP user stories

## 3.1 Create draft version

Acceptance criteria:

- New workflow starts with Version 1 draft.
- Editing an active/verified version creates a new draft version instead of mutating the active/verified version.
- Draft version number increments logically.

## 3.2 View version history

Acceptance criteria:

- Versioning tab shows versions, status, created/updated dates, published/activated date, source, tester/reviewer summary, and active badge.
- User can open a version read-only or editable depending on status.

## 3.3 Activate verified version

Acceptance criteria:

- Only verified version can be activated.
- Activating version records timestamp and actor.
- Previous active version becomes superseded or inactive.
- Catalog displays active version.

## 3.4 Amend review

Acceptance criteria:

- Reviewer can request amendment from a verified/in-review flow where allowed.
- Amendment creates or reopens a draft copy, not mutate verified evidence.

# 4. Status transition rules

Allowed MVP transitions:

- Draft → In Review.
- In Review → Verified.
- In Review → Draft, through amend/reject.
- Verified → Active.
- Active → Superseded when another version becomes active.
- Draft → Archived.

Blocked transitions:

- Active → Draft by direct mutation.
- Verified → Draft by direct mutation.
- Failed verification → Active.
- Deleted version with execution evidence.

# 5. Data model touchpoints

- `Workflow`
- `WorkflowVersion`
- `WorkflowVersionSnapshot`
- `VerificationRecord`
- `ActivationRecord`
- `VersionSourceReference`

# 6. Tests

Minimum tests:

- New workflow creates Version 1 draft.
- Verified version is immutable.
- Active version is immutable.
- Only verified version can activate.
- Activating new version deactivates/supersedes old active version.
- Version tab displays correct status and source.
