import { describe, it, expect } from "vitest";
import {
  parseExpression,
  validateExpression,
  compileExpressionToSql,
  collectReferences,
  ExpressionError,
  type ExpressionContext
} from "../src/expression.js";
import type { ParameterDefinition } from "../src/parameters.js";

const params: ParameterDefinition[] = [
  { key: "multiple_approver_threshold", label: "Multiple Approver Threshold", type: "decimal", required: true, defaultValue: 1000 },
  { key: "timeliness_threshold", label: "Timeliness Threshold", type: "integer", required: true, defaultValue: 60 },
  { key: "keyword", label: "Keyword", type: "text", required: false, defaultValue: "alcohol" }
];

const ctx: ExpressionContext = {
  columns: {
    "Amount in USD": "decimal",
    "Description": "text",
    "Date Expense Incurred": "date",
    "Approval Date": "date",
    "Receipt ID": "text"
  },
  parameters: params
};

describe("expression parsing", () => {
  it("parses a comparison with parameter reference", () => {
    const ast = parseExpression("{Amount in USD} >= {param!multiple_approver_threshold}");
    expect(ast.kind).toBe("binary");
  });

  it("parses columns with spaces", () => {
    const ast = parseExpression('{Date Expense Incurred} > date("2026-01-01")');
    expect(ast.kind).toBe("binary");
  });

  it("parses boolean combinations and functions", () => {
    const ast = parseExpression(
      'is_null({Receipt ID}) and {Amount in USD} > 75 or {Description} contains "alcohol"'
    );
    expect(ast.kind).toBe("binary");
  });

  it("rejects malicious JavaScript-like input", () => {
    expect(() => parseExpression('process.env["SECRET"]')).toThrow(ExpressionError);
    expect(() => parseExpression("require('fs')")).toThrow(ExpressionError);
    expect(() => parseExpression("eval(1)")).toThrow(ExpressionError);
  });

  it("rejects unknown functions", () => {
    expect(() => parseExpression("system({Description})")).toThrow(/Unknown function/);
  });

  it("rejects empty expression", () => {
    expect(() => parseExpression("  ")).toThrow(ExpressionError);
  });
});

describe("expression validation", () => {
  it("validates a correct expression", () => {
    const r = validateExpression("{Amount in USD} >= {param!multiple_approver_threshold}", ctx);
    expect(r.ok).toBe(true);
    expect(r.resultType).toBe("boolean");
  });

  it("reports missing column with helpful message", () => {
    const r = validateExpression("{Amount} > 5", ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Column "Amount" was not found/);
    expect(r.errors[0]).toMatch(/Available columns/);
  });

  it("reports missing parameter", () => {
    const r = validateExpression("{Amount in USD} > {param!nope}", ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Parameter "nope" is not defined/);
  });

  it("reports type mismatch on arithmetic", () => {
    const r = validateExpression("{Description} + 5 > 3", ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Arithmetic/);
  });

  it("validates days_between with dates", () => {
    const r = validateExpression(
      "days_between({Date Expense Incurred}, {Approval Date}) > {param!timeliness_threshold}",
      ctx
    );
    expect(r.ok).toBe(true);
  });

  it("rejects days_between with non-dates", () => {
    const r = validateExpression("days_between({Description}, {Approval Date}) > 1", ctx);
    expect(r.ok).toBe(false);
  });
});

describe("SQL compilation", () => {
  const opts = {
    parameterDefinitions: params,
    parameterValues: { multiple_approver_threshold: 1000, timeliness_threshold: 60, keyword: "alcohol" }
  };

  it("compiles comparison with quoted identifiers and typed literal", () => {
    const sql = compileExpressionToSql("{Amount in USD} >= {param!multiple_approver_threshold}", opts);
    expect(sql).toBe('("Amount in USD" >= 1000)');
  });

  it("escapes string literals to prevent injection", () => {
    const sql = compileExpressionToSql(`{Description} contains "a'; DROP TABLE x; --"`, opts);
    expect(sql).toContain("'a''; DROP TABLE x; --'");
    expect(sql).not.toContain("'a';");
  });

  it("escapes double quotes in column names", () => {
    const sql = compileExpressionToSql("{Amount in USD} > 5", opts);
    expect(sql).toBe('("Amount in USD" > 5)');
  });

  it("injects text parameters as escaped literals", () => {
    const sql = compileExpressionToSql("{Description} contains {param!keyword}", {
      ...opts,
      parameterValues: { ...opts.parameterValues, keyword: "o'brien" }
    });
    expect(sql).toContain("'o''brien'");
  });

  it("compiles date function", () => {
    const sql = compileExpressionToSql('{Approval Date} > date("2026-01-01")', opts);
    expect(sql).toBe(`("Approval Date" > CAST('2026-01-01' AS DATE))`);
  });

  it("compiles days_between to date_diff", () => {
    const sql = compileExpressionToSql(
      "days_between({Date Expense Incurred}, {Approval Date}) > {param!timeliness_threshold}",
      opts
    );
    expect(sql).toContain("date_diff('day'");
    expect(sql).toContain("> 60");
  });

  it("compiles in-lists", () => {
    const sql = compileExpressionToSql('{Description} in ("a", "b")', opts);
    expect(sql).toBe(`("Description" IN ('a', 'b'))`);
  });

  it("fails when a parameter value is missing", () => {
    expect(() =>
      compileExpressionToSql("{Amount in USD} > {param!multiple_approver_threshold}", {
        parameterDefinitions: params,
        parameterValues: {}
      })
    ).toThrow(/no value/);
  });
});

describe("collectReferences", () => {
  it("collects columns and parameters", () => {
    const refs = collectReferences(
      "is_null({Receipt ID}) and {Amount in USD} > {param!multiple_approver_threshold}"
    );
    expect(refs.columns.sort()).toEqual(["Amount in USD", "Receipt ID"]);
    expect(refs.parameters).toEqual(["multiple_approver_threshold"]);
  });
});
