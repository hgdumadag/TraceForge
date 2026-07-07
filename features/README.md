# MVP Feature Specifications Index

## What this file is for

This file lists the MVP feature specifications for the Local Audit Workflow & Analytics Builder. It helps agents choose the smallest relevant spec instead of loading every feature document.

## When to read this file

Read this file when deciding which feature spec applies to a task.

## When not to read this file

Do not read this file when the task already names the exact feature file to use.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Read `../project.md` for global rules when starting substantial work.
2. Read only the feature file directly related to the requested change.
3. Read `../gates.md` before claiming a task is complete.
4. Update this index if a new MVP feature file is added, renamed, or retired.
5. Treat `task-creation.md` and `task-deletion.md` as legacy/example files unless a task explicitly references them.

---

# MVP feature set

| Feature file | Read when building/changing |
|---|---|
| `workflow-catalog.md` | Workflow list, search, filter, status badges, active version display, columns |
| `workflow-creation.md` | Blank workflow creation, cloning templates, first draft version, duplicate workflow |
| `template-library.md` | Audit template catalog, categories, clone-template wizard, template metadata |
| `canvas-builder.md` | Visual node canvas, drag/drop, edges, groups, notes, zoom/pan, minimap |
| `data-import.md` | CSV/Excel/import API/sample data/new local table input behavior |
| `node-configuration.md` | Tool/node configuration panels and MVP node behaviors |
| `expression-language.md` | Formula syntax, field references, parameters, validation, safe evaluation |
| `parameters.md` | Workflow-level typed parameters, defaults, runtime overrides, file inputs |
| `workflow-execution.md` | Run workflow, DAG execution, node statuses, error handling, cancellations |
| `data-preview.md` | Tabular preview after each node, data types, row counts, samples, profiling |
| `run-history.md` | Stored execution records, logs, outputs, input fingerprints, rerun behavior |
| `versioning.md` | Draft/verified/active versions, immutability, activation, version history |
| `verification-review.md` | Tester/reviewer workflow, sample runs, pass/fail, amend review, evidence review |
| `publish-to-toolkit.md` | Publish verified versions as reusable tools/templates, unpublish behavior |
| `local-llm-provider.md` | Ollama/OpenAI/Azure AI Foundry provider selection and AI-assisted features |

# MVP boundary

The MVP should let a user create or clone an audit workflow, import tabular data, configure common transformation/validation nodes, run the workflow locally, inspect outputs, store run history, verify a version, and publish the verified version as a reusable toolkit item.

The MVP does not need full enterprise multi-tenancy, distributed workers, external webhooks, SAML, fine-grained RBAC, collaborative editing, or a public plugin marketplace. These should be deferred unless explicitly requested.
