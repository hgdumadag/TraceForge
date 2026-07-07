# Feature Specification: Node Configuration

## What this file is for

This file defines how users configure workflow nodes/tools and what MVP nodes must support.

## When to read this file

Read this file when building or changing:

- The node configuration drawer/modal.
- Tool palette definitions.
- Dynamic forms based on node schemas.
- MVP transformation and validation node configuration.
- Node input/output schema definitions.

## When not to read this file

Do not read this file for canvas drag/drop mechanics, expression evaluation internals, workflow execution engine, or data import parsing except where node configuration references them.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Node configuration must be schema-driven where possible.
2. Do not hard-code UI forms separately from node definitions unless justified.
3. Each node type must define inputs, outputs, parameters, validation rules, and execution handler.
4. Preserve node config in workflow version JSON.
5. Add tests for every changed node schema and config validation.

---

# 1. Feature summary

Users configure nodes through a side panel or modal. The panel should show the node name, purpose, configuration fields, input preview, output preview, validation messages, and help/documentation.

# 2. MVP node categories

## Import

- Import File.
- Import from API.
- Import Sample Data.
- New Table.

## Clean

- Find Replace.
- Text to Columns.
- Parse JSON.
- Sample.
- Validate.

## Merge

- Join.
- Append.

## Transform

- Add Columns.
- Edit Columns.
- Overwrite Columns.
- Select Columns.
- Filter.
- Sort.
- Deduplicate.
- Pivot.
- Unpivot.

## Visualize

- Chart.

## Advanced

- Python, optional for MVP if sandbox is not ready.
- Publish to Toolkit, governed by `publish-to-toolkit.md`.

# 3. Dynamic configuration UI

Acceptance criteria:

- Clicking a node opens configuration.
- Configuration fields are generated from node schema.
- Required fields are marked.
- Invalid configuration blocks save or run.
- User can preview input data while configuring when input data exists.
- User can save configuration and return to canvas.

# 4. MVP node behavior

## 4.1 Filter

- User defines a filter expression.
- Optional row limit is supported.
- Node outputs matching rows and optionally non-matching rows.

## 4.2 Add Columns

- User can add one or more calculated columns.
- Each calculated column has name, type, and expression.
- Existing columns are not overwritten unless user chooses Overwrite Columns.

## 4.3 Select/Edit/Overwrite Columns

- Select Columns chooses subset and order.
- Edit Columns renames columns and changes types where safe.
- Overwrite Columns replaces values using expression rules.

## 4.4 Join

- User selects left and right inputs.
- User chooses join keys and join type.
- MVP join types: inner, left, full outer if DuckDB implementation supports it.

## 4.5 Append

- User combines rows from compatible tables.
- App warns if schemas differ and offers align-by-name.

## 4.6 Deduplicate

- User selects key columns.
- User chooses keep first, keep last, or keep based on sort field.

## 4.7 Validate

- User defines validation name, condition, severity, and output columns.
- Node outputs validation results/exception table.

## 4.8 Chart

- User selects chart type, dimensions, and measures.
- MVP charts are local preview only, not dashboard publishing.

# 5. Node schema minimum

```json
{
  "type": "filter",
  "label": "Filter",
  "category": "Transform",
  "inputs": [{ "name": "input", "kind": "dataset", "required": true }],
  "outputs": [{ "name": "true", "kind": "dataset" }],
  "configSchema": {},
  "executionHandler": "filter.execute"
}
```

# 6. Data model touchpoints

- `NodeTypeRegistry`
- `NodeConfigSchema`
- `WorkflowVersion.nodes`
- `NodeExecutionResult`
- `DatasetSchema`

# 7. Tests

Minimum tests:

- Node configuration opens from canvas.
- Required fields block save/run.
- Filter node validates expression.
- Add Columns blocks duplicate output names unless overwrite is explicit.
- Join validates key columns.
- Deduplicate validates selected keys.
- Node config survives save and reload.
