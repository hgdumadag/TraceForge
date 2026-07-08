# Feature Specification: Expression Language

## What this file is for

This file defines the formula/expression language used in filters, calculated columns, validations, parameters, and node configuration.

## When to read this file

Read this file when building or changing:

- Filter expressions.
- Calculated columns.
- Validation conditions.
- Field references.
- Parameter references.
- Expression parser, validator, compiler, or safe evaluator.

## When not to read this file

Do not read this file for visual canvas behavior, LLM provider selection, or storage decisions unless expressions affect them.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Expressions are untrusted input and must not execute arbitrary host code.
2. Use a restricted expression grammar, not JavaScript `eval`.
3. Validate expressions before saving and before execution.
4. Give helpful error messages for auditors.
5. Add tests for valid expressions, invalid expressions, type errors, and parameter references.

---

# 1. Feature summary

The expression language lets users define audit rules such as:

```text
{Amount in USD} >= {param!multiple_approver_threshold}
{Description} contains "alcohol"
days_between({Date Expense Incurred}, {Approval Date}) > {param!timeliness_threshold}
is_null({Receipt ID}) and {Amount in USD} > {param!receipt_threshold}
```

The MVP language should feel familiar to spreadsheet and audit analytics users while compiling safely to DuckDB SQL or a controlled evaluator.

# 2. MVP syntax

## 2.1 Field references

- `{Column Name}` references a column in the input dataset.
- Column names are case-sensitive by default unless the engine normalizes them.
- Missing columns must produce validation errors before run.

## 2.2 Parameter references

- `{param!parameter_key}` references a workflow parameter.
- Missing parameter keys must produce validation errors.
- Parameter type must be compatible with expression usage.

## 2.3 Literals

Support:

- Text: `"abc"`.
- Numbers: `100`, `100.25`.
- Booleans: `true`, `false`.
- Dates using function wrapper: `date("2026-01-01")`.
- Null: `null`.

## 2.4 Operators

Support:

- Equality: `=`, `!=`.
- Comparison: `>`, `>=`, `<`, `<=`.
- Boolean: `and`, `or`, `not`.
- Arithmetic: `+`, `-`, `*`, `/` where types allow.
- Text contains: `contains`.
- Membership: `in` / `not in` with a literal list, e.g. `{Department} in ("Finance", "Treasury")`.

## 2.5 Functions

MVP functions:

- `is_null(value)`.
- `not_null(value)`.
- `lower(text)`.
- `upper(text)`.
- `trim(text)`.
- `contains(text, search)`.
- `days_between(date1, date2)`.
- `date(text)`.
- `coalesce(value1, value2)`.
- `abs(number)`.
- `round(number, places)`.
- `length(text)`.

# 3. Acceptance criteria

- User sees expression validation while configuring a node.
- User sees a readable error when a column or parameter is missing.
- Expressions can be compiled to a safe execution plan.
- Expressions cannot access files, network, environment variables, process objects, or arbitrary code.
- Expression help/examples are available in the UI.

# 4. Security rules

Forbidden:

- JavaScript `eval`.
- Dynamic function constructors.
- Host process access.
- File system access.
- Network access.
- Arbitrary Python execution through expression language.

Custom code belongs in a separate Python/custom-code node with stronger sandboxing.

# 5. Data model touchpoints

- `ExpressionAst`
- `ExpressionValidationResult`
- `WorkflowParameterDefinition`
- `DatasetSchema`
- `NodeConfig.expression`

# 6. Tests

Minimum tests:

- Valid comparison expression parses.
- Parameter reference resolves.
- Missing column returns validation error.
- Type mismatch returns validation error.
- Date function compiles.
- Malicious JavaScript-like expression is rejected.
- Expression with spaces in column names works.
