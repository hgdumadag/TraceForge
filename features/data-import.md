# Feature Specification: Data Import

## What this file is for

This file defines how users bring data into workflows through files, APIs, integrations, sample data, or local tables.

## When to read this file

Read this file when building or changing:

- Import File node.
- Import from API node.
- Import Sample Data node.
- New Table behavior.
- File parsing, schema detection, dataset storage, and input fingerprints.
- Data import previews.

## When not to read this file

Do not read this file for downstream transformations, run-history display, or LLM provider behavior unless AI is assisting import mapping.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Treat imported audit data as sensitive by default.
2. Do not upload imported data to any external service by default.
3. Store source fingerprints for evidence and reproducibility.
4. Preserve original imported files or immutable dataset snapshots when used in verified runs.
5. Use DuckDB-compatible storage paths where possible.

---

# 1. Feature summary

Users must be able to import audit data locally and use it as the starting point for audit analytics workflows.

MVP inputs:

- CSV.
- Excel `.xlsx`.
- Local sample datasets.
- Manually created local table.
- HTTP/API import, optional and disabled gracefully when offline.

# 2. MVP user stories

## 2.1 Import CSV or Excel file

Acceptance criteria:

- User can select a local file.
- App detects sheets for Excel and asks user to select a sheet when needed.
- App detects column names and basic types.
- App shows preview rows before committing.
- App creates a dataset snapshot with schema and file fingerprint.
- User can rename the dataset.

## 2.2 Import sample data

Acceptance criteria:

- User can choose from built-in sample datasets.
- Sample data can be used without Internet.
- Sample dataset has known schema and enough rows to test templates.

## 2.3 Create new local table

Acceptance criteria:

- User can define table name and columns.
- User can enter or paste rows in a grid.
- App validates column names and data types.
- Table is stored locally and available as workflow input.

## 2.4 Import from API

Acceptance criteria:

- User can define URL, method, headers, body, and optional credential reference.
- App previews returned JSON/CSV where possible.
- User can flatten JSON into a table for downstream nodes.
- Offline or network failure shows a clear error.
- Credentials are referenced by ID, not stored in node config.

# 3. Dataset rules

- Imported dataset snapshot should be immutable once used in an execution.
- The workflow version may reference a dataset parameter instead of a fixed dataset to allow reuse.
- File fingerprint should include path metadata where allowed, size, modified timestamp, and content hash if practical.
- Type detection should be editable by the user.

# 4. Supported MVP data types

- Text.
- Integer.
- Decimal.
- Boolean.
- Date.
- DateTime.
- Unknown.

# 5. Data model touchpoints

- `Dataset`
- `DatasetVersion`
- `DatasetSchema`
- `DatasetColumn`
- `WorkflowInputBinding`
- `FileFingerprint`
- `CredentialReference`

# 6. Error handling

- Unsupported file format: show supported formats.
- Empty file: allow import only if schema can be defined manually.
- Duplicate columns: auto-suggest unique names and ask user to confirm.
- Type inference conflict: default to text and show warning.
- API authentication failure: show status code and safe error message without leaking secrets.

# 7. Tests

Minimum tests:

- CSV import detects columns and preview rows.
- Excel import handles multiple sheets.
- Duplicate columns are resolved safely.
- Dataset snapshot and fingerprint are stored.
- Sample data works offline.
- API import stores credential references safely.
