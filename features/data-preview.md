# Feature Specification: Data Preview

## What this file is for

This file defines tabular previews shown after imports and node executions, including row samples, column types, row counts, and simple profiling.

## When to read this file

Read this file when building or changing:

- Node output preview grid.
- Import preview grid.
- Column type display.
- Row count/null count/profile summaries.
- Preview caching and limits.
- Safe rendering of sensitive data.

## When not to read this file

Do not read this file for the execution engine itself, node configuration details, or verification decisions except where previews support review.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Previews are for inspection; they must not mutate datasets.
2. Do not load huge datasets fully into the UI.
3. Display row and column limits clearly.
4. Preserve data privacy; avoid sending preview rows to LLMs by default.
5. Add tests for preview limits, data types, and empty/error states.

---

# 1. Feature summary

Users need to see what each node produced. The preview grid should feel like an audit analytics table: rows, columns, data types, nulls, sample values, and output names.

# 2. MVP user stories

## 2.1 Preview imported data

Acceptance criteria:

- After importing data, user sees columns and sample rows.
- Data types are visible per column.
- Row count is shown when available.
- Preview limit is shown, e.g. first 100 rows.

## 2.2 Preview node output

Acceptance criteria:

- Clicking a node output opens preview grid.
- Preview shows output table name, row count, columns, types, and sample rows.
- If node has multiple outputs, user can select which output to preview.
- Failed node shows error instead of stale preview.
- Chart node outputs render the configured chart (SVG) above the aggregated table in the same preview.

## 2.3 Profile columns

Acceptance criteria:

- MVP profile shows null count, distinct count estimate if cheap, min/max for numeric/date columns, and sample values.
- Profile calculations are limited and do not freeze UI.

# 3. Preview limits

Default MVP limits:

- Display rows: 100 by default.
- Display columns: support horizontal scrolling.
- Profile calculations: run only on request or on limited sample unless cheap.
- Large text values: truncate with expand option.

# 4. Data model touchpoints

- `DatasetVersion`
- `DatasetPreviewCache`
- `NodeExecutionResult`
- `ColumnProfile`

# 5. UI rules

- Show data types near column names.
- Show null values clearly as `null`, not blank.
- Preserve numeric formatting but avoid changing actual values.
- Allow copy selected cells/rows where safe.
- Do not hide negative numbers, decimals, or dates through formatting.

# 6. Error handling

- No output yet: show `Run the workflow or node to see preview`.
- Output expired/missing: show clear message and option to rerun.
- Large dataset: show limited preview and explain row limit.
- Unsupported type: display as text with warning.

# 7. Tests

Minimum tests:

- Preview shows first rows and column headers.
- Nulls display as null.
- Numeric/date/text data types display.
- Large dataset uses limit.
- Multi-output node lets user switch outputs.
- Failed node does not show stale successful preview as current.
