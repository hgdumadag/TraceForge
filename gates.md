# Gates: Definition of Done and Required Checks

## What this file is for

This file defines the required checks before any task is considered complete. It is the project’s quality gate and delivery checklist.

## When to read this file

Read this file before finishing any task, pull request, or agent implementation run.

## When not to read this file

Do not read this file at the start of every small task unless you need to understand completion expectations. Read it before finalizing work.

## Related files

- `features/README.md` — MVP feature index.
- `project.md` — global rules and architecture.
- `features/task-creation.md` — task/workflow creation checks.
- `features/task-deletion.md` — task/workflow deletion checks.
- `decisions.md` — decisions that may affect gates.
- `glossary.md` — definitions.

## Agent instructions

Before claiming work is done:

1. Check every relevant gate below.
2. State any gate that was not completed.
3. Do not claim tests passed unless they were actually run.
4. Do not silently weaken security, evidence, or local-first behavior.
5. Update specs or decisions when behavior changes.

---

# 1. Universal gate

Every task must satisfy these before completion:

- The change matches the requested behavior.
- The change does not conflict with `project.md`.
- The change does not conflict with `decisions.md`.
- Relevant feature spec was read if one exists.
- Tests were added or updated for changed behavior.
- Existing tests pass, or failures are clearly explained.
- No secrets, tokens, credentials, or private data were committed.
- No unrelated broad refactor was introduced.
- User-facing behavior is documented if changed.

---

# 2. Local-first gate

Required when a change touches storage, networking, LLMs, execution, integrations, or deployment.

- App works without Internet for local-only workflows.
- Local data is not uploaded to external services by default.
- Cloud LLM calls are opt-in only.
- Network-required nodes show clear status or error when offline.
- Local services bind to localhost by default.
- Remote access requires explicit configuration.

---

# 3. Audit governance gate

Required when a change touches workflow lifecycle, versions, verification, publishing, deletion, execution history, or evidence.

- Executed workflow versions remain immutable.
- Verified workflow versions remain immutable.
- Active version changes are controlled and auditable.
- Reviewer/tester actions are timestamped.
- Evidence records are preserved.
- Archive/delete behavior does not destroy audit history by default.
- Published tools point only to verified versions.
- Any exception is documented in `decisions.md`.

---

# 4. Data integrity gate

Required when a change touches datasets, imports, transformations, previews, exports, or cache.

- Input files are fingerprinted where applicable.
- Transform nodes create new dataset versions rather than mutating prior outputs.
- Data previews are read-only.
- Row counts and schema summaries are correct.
- Null handling is explicit.
- Data type conversions are tested.
- Large-file behavior is considered.
- Exported files match displayed results.

---

# 5. Workflow engine gate

Required when a change touches graph execution, nodes, edges, parameters, triggers, retries, scheduling, or logs.

- Workflow graph schema validates before execution.
- Edges cannot reference missing nodes.
- Required node parameters are enforced.
- Parameter resolution is deterministic.
- Node execution status is persisted.
- Execution logs are available after run.
- Errors stop or branch according to defined behavior.
- Cancelled/failed runs leave a useful diagnostic trail.
- Tests cover success and failure paths.

---

# 6. Security gate

Required for any change touching credentials, custom code, Python execution, HTTP/API nodes, file access, plugins, LLM tools, MCP, or remote access.

- Raw secrets are never stored in workflow JSON.
- Raw secrets are never shown in logs.
- Credentials are encrypted at rest.
- Custom code does not run in the main app process.
- File access is scoped and intentional.
- HTTP/API nodes are designed with SSRF protection.
- Shell command execution is disabled by default.
- LLM-generated code is treated as untrusted.
- Plugin code is validated or sandboxed according to current project maturity.

---

# 7. LLM gate

Required when a change touches Ollama, OpenAI, Azure AI Foundry, embeddings, RAG, AI-generated workflows, AI explanations, or agent behavior.

- Provider interface is used; provider-specific code is not scattered.
- Ollama remains the default provider unless user config changes it.
- Cloud providers require explicit configuration and selection.
- Structured outputs are schema-validated.
- LLM-generated workflow changes require user review before save.
- Sensitive data is redacted where required.
- Provider errors fail safely.
- Mock provider tests exist for deterministic behavior.
- Token/cost/latency metadata is logged when available.

---

# 8. UI/UX gate

Required when a change touches screens, workflow canvas, modals, tables, forms, previews, or navigation.

- Loading states exist for async actions.
- Error messages are understandable to auditors, not only developers.
- Destructive actions require confirmation.
- Long-running actions show progress.
- Canvas changes are visible and reversible where possible.
- Data grid remains usable with sample datasets.
- Accessibility basics are preserved: labels, focus states, keyboard path where feasible.
- Screens are checked at common desktop sizes.

---

# 9. Testing gate

Minimum expected tests by change type:

| Change type | Required tests |
|---|---|
| Domain schema | Unit tests |
| Node behavior | Unit and integration tests |
| Workflow execution | Integration tests |
| UI form/canvas | Component and/or E2E tests |
| Deletion/archive | Unit, integration, and audit/evidence tests |
| LLM provider | Mock provider unit tests and one integration path where feasible |
| Security-sensitive code | Negative tests and redaction tests |
| Data transformations | Deterministic input/output fixture tests |

Do not mark a task complete without stating what was tested.

---

# 10. Documentation gate

Update documentation when:

- Behavior changes.
- A new feature is added.
- A new data model entity is added.
- A decision is made or reversed.
- A security posture changes.
- A new provider or integration is added.

Documentation updates may include:

- Feature spec.
- `project.md`.
- `decisions.md`.
- User-facing help.
- Node documentation.
- Template documentation.

---

# 11. Migration and compatibility gate

Required when a change touches stored data or schema.

- Migration is forward-only or rollback approach is documented.
- Existing local projects still load.
- Corrupt or old records fail gracefully.
- Versioned workflow JSON remains readable.
- Data model changes are reflected in specs.

---

# 12. Release gate

Before a release candidate:

- All critical tests pass.
- Local install path tested.
- App starts offline.
- Sample template runs successfully.
- Evidence export works.
- Ollama path tested or clearly marked unavailable.
- Cloud providers disabled by default.
- Backup/export path documented.
- Known limitations documented.

---

# 13. Final response gate for agents

When reporting completion, include:

- What changed.
- What files changed.
- What tests were run.
- What was not tested.
- Any known limitations.
- Any decisions that should be added to `decisions.md`.
