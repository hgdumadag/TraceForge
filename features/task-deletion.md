# Feature Specification: Workflow / Audit Task Deletion and Archiving

## What this file is for

This file defines the behavior, rules, and tests for deleting, archiving, restoring, and protecting workflow/audit test tasks.

In this project, a “task” means a reusable audit workflow or audit analytics test. Deletion is sensitive because workflow versions, executions, verification records, and output datasets may be audit evidence.

## When to read this file

Read this file only when building or changing behavior related to:

- Deleting workflows.
- Archiving workflows.
- Restoring archived workflows.
- Deleting draft versions.
- Handling evidence records during deletion.
- Removing templates or published tools.

## When not to read this file

Do not read this file for:

- Creating workflows.
- Running workflows.
- Editing node behavior.
- LLM provider behavior.
- General data model changes unless deletion rules are affected.

## Related files

- `../project.md` — global product and architecture rules.
- `task-creation.md` — workflow/audit task creation behavior.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.

## Agent instructions

When implementing this feature:

1. Prefer soft delete/archive over hard delete.
2. Never delete verified execution evidence by default.
3. Never orphan execution, verification, or published tool records.
4. Require confirmation for destructive actions.
5. Keep deletion behavior auditable.
6. Add tests for evidence-preserving behavior.

---

# 1. Feature summary

Users must be able to remove workflow/audit tasks from normal use without compromising audit evidence.

The default action is **archive**, not hard delete.

A workflow that has no executions and no verified versions may be permanently deleted only if the user has appropriate permission and confirms the action.

A workflow with executions, verification records, active versions, or published toolkit references must be archived instead of physically deleted.

---

# 2. Deletion model

## 2.1 Actions

| Action | Meaning | Data effect |
|---|---|---|
| Archive workflow | Hide from normal catalog and prevent new runs unless restored | Sets `archivedAt` / status `archived` |
| Restore workflow | Return archived workflow to catalog | Clears `archivedAt` if allowed |
| Delete draft version | Remove an unused draft version | May physically delete if no execution/evidence references |
| Hard delete workflow | Permanently remove workflow metadata | Allowed only for unexecuted, unverified, unpublished workflows |
| Unpublish tool | Remove from toolkit but keep workflow/version | Removes or deactivates `PublishedTool` record |

## 2.2 Default behavior

- Catalog delete action should show as `Archive` when the workflow has any audit-relevant history.
- `Delete permanently` should be hidden or disabled unless the workflow is safe to hard delete.
- Archived workflows are hidden from default catalog view but visible through an `Archived` filter.

---

# 3. User stories

## 3.1 Archive workflow

As an audit manager, I want to archive an old workflow so users stop running it while evidence remains available.

Acceptance criteria:

- User can choose Archive from workflow menu.
- System shows confirmation dialog.
- Confirmation explains that past executions and evidence will be retained.
- Workflow is removed from default catalog view.
- Workflow appears in archived filter.
- Existing execution history remains readable.
- Published toolkit entry is deactivated or marked archived.
- Active schedules or automations are disabled.

## 3.2 Hard delete safe draft workflow

As a builder, I want to permanently delete an accidental draft workflow that was never used.

Acceptance criteria:

- Hard delete is available only if workflow has no executions, no verified versions, no active version, no published tool, and no external automation references.
- User must type or confirm the workflow name.
- System deletes the workflow and draft version in a transaction.
- Workflow no longer appears in catalog or archived filter.

## 3.3 Prevent unsafe hard deletion

As an audit reviewer, I want the system to prevent deletion of verified or executed workflows so audit evidence is preserved.

Acceptance criteria:

- Hard delete is disabled for workflows with execution history.
- Hard delete is disabled for workflows with verified versions.
- Hard delete is disabled for workflows published to toolkit.
- User sees the reason why hard delete is unavailable.
- Archive remains available if user has permission.

## 3.4 Restore archived workflow

As a workflow owner, I want to restore an archived workflow if it becomes relevant again.

Acceptance criteria:

- User can restore archived workflow.
- Restored workflow returns to catalog.
- Restored workflow does not automatically reactivate schedules unless user confirms.
- Published toolkit entry remains unpublished unless user republishes or confirms restore-to-toolkit behavior.

---

# 4. Business rules

## 4.1 Evidence preservation

The following must never be deleted by default:

- Execution records.
- Node execution records.
- Verification reviews.
- Evidence summaries.
- Input file hashes.
- Output dataset hashes.
- Active version history.

## 4.2 Active workflow rules

If a workflow is active:

- Archive must deactivate active schedules and connected automations.
- Archive must preserve active version record.
- Archive must not change past execution results.

## 4.3 Published tool rules

If a workflow is published to toolkit:

- Archiving the workflow must unpublish or deactivate the toolkit entry.
- Existing references must show that the source workflow is archived.
- Published version record must remain available for evidence review.

## 4.4 Draft version deletion rules

Draft versions can be deleted if:

- They are not active.
- They were never executed.
- They were never submitted for review, or review records are also explicitly discarded according to policy.
- They are not source versions for another version.

## 4.5 Template deletion rules

Templates should follow the same default archive-first rule.

A template used as a source for cloned workflows must not be hard deleted unless clone lineage is preserved independently.

---

# 5. UI behavior

## 5.1 Workflow menu

Workflow menu may show:

- Archive.
- Restore.
- Delete permanently.
- Unpublish from Toolkit.
- View deletion constraints.

## 5.2 Confirmation dialog for archive

Archive confirmation must state:

- Workflow will be hidden from normal use.
- Past runs and evidence will be retained.
- Active schedules/automations will be disabled.
- Published toolkit entry may be deactivated.

Buttons:

- Cancel.
- Archive workflow.

## 5.3 Confirmation dialog for permanent delete

Permanent delete confirmation must state:

- Action cannot be undone.
- Only safe draft/unexecuted workflows can be deleted.
- User must confirm by typing workflow name or checking explicit confirmation.

Buttons:

- Cancel.
- Delete permanently.

## 5.4 Disabled action explanations

If permanent delete is disabled, show one or more reasons:

- Workflow has execution history.
- Workflow has verified versions.
- Workflow is active.
- Workflow is published to toolkit.
- Workflow has connected automations.
- Workflow is source for another workflow/template.

---

# 6. Data behavior

## 6.1 Archive workflow data changes

Set:

- `workflow.status = archived`
- `workflow.archivedAt = now`
- `workflow.archivedBy = currentUser`
- `publishedTool.status = archived` if applicable
- `schedule.status = disabled` if applicable

Do not delete:

- `WorkflowVersion`
- `Execution`
- `NodeExecution`
- `DatasetVersion`
- `VerificationReview`

## 6.2 Restore workflow data changes

Set:

- `workflow.status = draft` or previous non-archived state where safe
- `workflow.archivedAt = null`
- `workflow.archivedBy = null`

Do not automatically:

- Re-enable schedules.
- Republish toolkit entries.
- Mark unverified versions as verified.

## 6.3 Hard delete data changes

Hard delete may remove:

- `Workflow`
- Draft `WorkflowVersion`
- Nodes and edges stored only in that draft version
- Unsaved local cache for that workflow

Hard delete must fail if audit evidence or downstream references exist.

---

# 7. Permissions and safety

MVP may be single-user. For future multi-user mode:

| Role | Archive | Restore | Hard delete safe draft | Hard delete with evidence |
|---|---:|---:|---:|---:|
| Runner | No | No | No | No |
| Builder | Own workflows only | Own workflows only | Own safe drafts only | No |
| Reviewer | Yes | Yes | No | No |
| Admin | Yes | Yes | Yes | No by default |

Hard delete with evidence is not supported by default. If ever added, it must require a separate retention policy decision and explicit approval.

---

# 8. Test scenarios

## 8.1 Unit tests

- Determines that unexecuted draft workflow is safe to hard delete.
- Determines that workflow with execution is not safe to hard delete.
- Determines that workflow with verified version is not safe to hard delete.
- Determines that workflow with published tool is not safe to hard delete.
- Determines that workflow with connected automation is not safe to hard delete.
- Archive operation preserves execution records.
- Archive operation disables schedules.
- Restore operation does not auto-enable schedules.
- Permanent delete requires confirmation.

## 8.2 Integration tests

- Create workflow, archive it, confirm it disappears from default catalog.
- Archive workflow with execution history, confirm run history remains readable.
- Attempt hard delete of verified workflow and confirm failure.
- Hard delete unexecuted draft workflow and confirm records are removed.
- Restore archived workflow and confirm it appears in catalog.
- Archive published workflow and confirm toolkit entry is deactivated.

## 8.3 E2E tests

- User archives a workflow from workflow list.
- User filters to archived workflows and restores one.
- User tries to permanently delete a workflow with run history and sees blocked action.
- User permanently deletes a new accidental draft workflow.

## 8.4 Security and audit tests

- Archive action writes audit log entry.
- Restore action writes audit log entry.
- Hard delete action writes audit log entry.
- Execution evidence remains accessible after archive.
- No credential secrets are exposed in deletion logs.

---

# 9. Edge cases

| Case | Expected behavior |
|---|---|
| Workflow is running during archive request | Ask user to cancel/stop run first or archive after completion. |
| Workflow has scheduled trigger | Disable schedule on archive. |
| Workflow is referenced by another workflow | Block hard delete; allow archive with warning. |
| Workflow has pending review | Archive allowed only after warning; review status preserved. |
| Restore name conflicts with active workflow | Require rename or block restore. |
| Archive fails midway | Transaction must rollback where possible. |
| Local cache remains after hard delete | Cache must be cleaned or marked unreachable. |

---

# 10. Definition of done for this feature

This feature is done only when:

- Archive works and preserves evidence.
- Restore works and does not silently reactivate schedules or toolkit publishing.
- Hard delete is available only for safe drafts.
- Unsafe hard delete attempts are blocked with clear explanations.
- Deletion behavior is covered by unit, integration, and E2E tests.
- Audit logs are written for archive, restore, and hard delete.
