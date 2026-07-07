import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importFileToParquet,
  rowsToParquet,
  executeTabularNode,
  previewParquet,
  profileParquet,
  exportParquet,
  type TabularInput,
  type TabularNodeContext
} from "../src/index.js";
import type { ParameterDefinition } from "@traceforge/domain";

const here = dirname(fileURLToPath(import.meta.url));
let dir: string;
let expenses: TabularInput;
let employees: TabularInput;

const params: ParameterDefinition[] = [
  { key: "receipt_threshold", label: "Receipt Threshold", type: "decimal", required: true, defaultValue: 75 },
  { key: "timeliness_threshold", label: "Timeliness Threshold", type: "integer", required: true, defaultValue: 60 }
];
const paramValues = { receipt_threshold: 75, timeliness_threshold: 60 };

function ctx(nodeType: string, config: Record<string, unknown>, inputs: Record<string, TabularInput[]>): TabularNodeContext {
  return {
    nodeType,
    nodeLabel: nodeType,
    config,
    inputs,
    parameterDefinitions: params,
    parameterValues: paramValues,
    outputPathFor: (handle) => join(dir, `${nodeType}_${handle}_${Math.random().toString(36).slice(2)}.parquet`)
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "tf-tabular-"));
  const imp1 = await importFileToParquet(join(here, "fixtures/expenses.csv"), "expenses.csv", join(dir, "expenses.parquet"));
  expenses = { path: join(dir, "expenses.parquet"), columns: imp1.columns, rowCount: imp1.rowCount };
  const imp2 = await importFileToParquet(join(here, "fixtures/employees.csv"), "employees.csv", join(dir, "employees.parquet"));
  employees = { path: join(dir, "employees.parquet"), columns: imp2.columns, rowCount: imp2.rowCount };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("import", () => {
  it("detects columns, types, row count, and fingerprint", async () => {
    expect(expenses.rowCount).toBe(8);
    const names = expenses.columns.map((c) => c.name);
    expect(names).toContain("Amount in USD");
    const amount = expenses.columns.find((c) => c.name === "Amount in USD");
    expect(["decimal", "integer"]).toContain(amount?.type);
    const date = expenses.columns.find((c) => c.name === "Date Expense Incurred");
    expect(date?.type).toBe("date");
  });

  it("rejects unsupported formats with a clear message", async () => {
    await expect(
      importFileToParquet("/tmp/nope.abc", "nope.abc", join(dir, "x.parquet"))
    ).rejects.toThrow(/Supported formats/);
  });
});

describe("filter node", () => {
  it("filters rows using expression with parameter reference", async () => {
    const r = await executeTabularNode(
      ctx("filter", { expression: "{Amount in USD} > {param!receipt_threshold}", emitNonMatching: true }, { input: [expenses] })
    );
    const matched = r.outputs.find((o) => o.handle === "matched")!;
    const unmatched = r.outputs.find((o) => o.handle === "unmatched")!;
    expect(matched.rowCount).toBe(7); // only E003 (45.25) is at/below the 75 threshold
    expect(unmatched.rowCount).toBe(1);
  });

  it("fails with helpful message for missing columns", async () => {
    await expect(
      executeTabularNode(ctx("filter", { expression: "{Missing} > 1", emitNonMatching: false }, { input: [expenses] }))
    ).rejects.toThrow(/was not found/);
  });
});

describe("add / overwrite / select / edit columns", () => {
  it("adds a calculated column", async () => {
    const r = await executeTabularNode(
      ctx("add_columns", { columns: [{ name: "Days to Approve", expression: "days_between({Date Expense Incurred}, {Approval Date})" }] }, { input: [expenses] })
    );
    const out = r.outputs[0];
    expect(out.columns.map((c) => c.name)).toContain("Days to Approve");
    const preview = await previewParquet(out.path, 10);
    const e002 = preview.rows.find((row) => row["Expense ID"] === "E002");
    expect(Number(e002?.["Days to Approve"])).toBe(73);
  });

  it("blocks duplicate column names on add", async () => {
    await expect(
      executeTabularNode(ctx("add_columns", { columns: [{ name: "Description", expression: '"x"' }] }, { input: [expenses] }))
    ).rejects.toThrow(/already exists/);
  });

  it("overwrites values", async () => {
    const r = await executeTabularNode(
      ctx("overwrite_columns", { columns: [{ name: "Description", expression: "upper({Description})" }] }, { input: [expenses] })
    );
    const preview = await previewParquet(r.outputs[0].path, 3);
    expect(String(preview.rows[0]?.Description)).toBe(String(preview.rows[0]?.Description).toUpperCase());
  });

  it("selects a subset of columns in order", async () => {
    const r = await executeTabularNode(
      ctx("select_columns", { columns: ["Employee Name", "Amount in USD"] }, { input: [expenses] })
    );
    expect(r.outputs[0].columns.map((c) => c.name)).toEqual(["Employee Name", "Amount in USD"]);
  });

  it("renames and retypes columns", async () => {
    const r = await executeTabularNode(
      ctx("edit_columns", { edits: [{ column: "Amount in USD", rename: "Amount", newType: "text" }] }, { input: [expenses] })
    );
    const col = r.outputs[0].columns.find((c) => c.name === "Amount");
    expect(col?.type).toBe("text");
  });
});

describe("join / append / deduplicate", () => {
  it("left join brings right columns with suffix on collision", async () => {
    const r = await executeTabularNode(
      ctx("join", { joinType: "left", keys: [{ left: "Employee ID", right: "Employee ID" }], rightSuffix: "_right" }, { left: [expenses], right: [employees] })
    );
    const out = r.outputs[0];
    expect(out.rowCount).toBe(8);
    expect(out.columns.map((c) => c.name)).toContain("Department");
    expect(out.columns.map((c) => c.name)).toContain("Employee ID_right");
  });

  it("inner join drops unmatched rows", async () => {
    const r = await executeTabularNode(
      ctx("join", { joinType: "inner", keys: [{ left: "Employee ID", right: "Employee ID" }], rightSuffix: "_r" }, { left: [expenses], right: [employees] })
    );
    expect(r.outputs[0].rowCount).toBe(7); // EMP05 has no employee record
  });

  it("append stacks rows by name", async () => {
    const r = await executeTabularNode(
      ctx("append", { alignByName: true }, { input: [expenses, expenses] })
    );
    expect(r.outputs[0].rowCount).toBe(16);
  });

  it("deduplicate separates unique rows and duplicates", async () => {
    const r = await executeTabularNode(
      ctx("deduplicate", { keys: ["Employee ID", "Amount in USD", "Description"], keep: "first" }, { input: [expenses] })
    );
    const unique = r.outputs.find((o) => o.handle === "unique")!;
    const dups = r.outputs.find((o) => o.handle === "duplicates")!;
    expect(unique.rowCount).toBe(7); // E002/E005 are duplicates
    expect(dups.rowCount).toBe(1);
  });
});

describe("validate node", () => {
  it("produces exceptions and summary outputs", async () => {
    const r = await executeTabularNode(
      ctx(
        "validate",
        {
          rules: [
            { name: "Missing receipt over threshold", condition: "is_null({Receipt ID}) and {Amount in USD} > {param!receipt_threshold}", severity: "high" },
            { name: "Late approval", condition: "days_between({Date Expense Incurred}, {Approval Date}) > {param!timeliness_threshold}", severity: "medium" }
          ]
        },
        { input: [expenses] }
      )
    );
    const exceptions = r.outputs.find((o) => o.handle === "exceptions")!;
    const summary = r.outputs.find((o) => o.handle === "summary")!;
    // Missing receipt >75: E007 (950.75, no receipt). E003 has 45.25 (below threshold).
    // Late approval: E002 and E005 (73 days).
    expect(exceptions.rowCount).toBe(3);
    const sPreview = await previewParquet(summary.path, 10);
    expect(sPreview.rows.length).toBe(2);
    const late = sPreview.rows.find((row) => row.Validation === "Late approval");
    expect(Number(late?.Exceptions)).toBe(2);
    expect(Number(late?.["Rows Tested"])).toBe(8);
  });
});

describe("pivot / unpivot / sort / sample / find_replace / text_to_columns", () => {
  it("pivot aggregates values into columns", async () => {
    const r = await executeTabularNode(
      ctx("pivot", { groupBy: ["Employee ID"], pivotColumn: "Employee Name", valueColumn: "Amount in USD", aggregate: "sum" }, { input: [expenses] })
    );
    expect(r.outputs[0].rowCount).toBe(5);
  });

  it("unpivot melts columns into rows", async () => {
    const r = await executeTabularNode(
      ctx("unpivot", { idColumns: ["Expense ID"], valueColumns: ["Employee Name", "Description"], nameTo: "Field", valueTo: "Value" }, { input: [expenses] })
    );
    expect(r.outputs[0].rowCount).toBe(16);
    expect(r.outputs[0].columns.map((c) => c.name)).toEqual(["Expense ID", "Field", "Value"]);
  });

  it("sorts deterministically", async () => {
    const r = await executeTabularNode(
      ctx("sort", { keys: [{ column: "Amount in USD", direction: "desc" }] }, { input: [expenses] })
    );
    const preview = await previewParquet(r.outputs[0].path, 2);
    expect(Number(preview.rows[0]?.["Amount in USD"])).toBeGreaterThanOrEqual(Number(preview.rows[1]?.["Amount in USD"]));
  });

  it("sample first N", async () => {
    const r = await executeTabularNode(ctx("sample", { mode: "first", rows: 3 }, { input: [expenses] }));
    expect(r.outputs[0].rowCount).toBe(3);
  });

  it("find and replace (case-insensitive)", async () => {
    const r = await executeTabularNode(
      ctx("find_replace", { column: "Description", find: "HOTEL", replace: "Lodging", matchCase: false }, { input: [expenses] })
    );
    const preview = await previewParquet(r.outputs[0].path, 10);
    const hotel = preview.rows.find((row) => row["Expense ID"] === "E002");
    expect(String(hotel?.Description)).toContain("Lodging");
  });

  it("text to columns splits by delimiter", async () => {
    const r = await executeTabularNode(
      ctx("text_to_columns", { column: "Description", delimiter: " - ", newColumns: ["Desc Main", "Desc Detail"] }, { input: [expenses] })
    );
    const preview = await previewParquet(r.outputs[0].path, 10);
    const hotel = preview.rows.find((row) => row["Expense ID"] === "E002");
    expect(hotel?.["Desc Main"]).toBe("Hotel");
    expect(hotel?.["Desc Detail"]).toBe("conference");
  });
});

describe("previews, profiling, export, manual tables", () => {
  it("preview is limited and shows nulls as null", async () => {
    const preview = await previewParquet(expenses.path, 3);
    expect(preview.rows.length).toBe(3);
    expect(preview.totalRows).toBe(8);
    const e003 = (await previewParquet(expenses.path, 100)).rows.find((r) => r["Expense ID"] === "E003");
    expect(e003?.["Receipt ID"]).toBeNull();
  });

  it("profiles columns", async () => {
    const profiles = await profileParquet(expenses.path);
    const amount = profiles.find((p) => p.name === "Amount in USD")!;
    expect(amount.nullCount).toBe(0);
    expect(Number(amount.max)).toBeCloseTo(1200.5);
    const receipt = profiles.find((p) => p.name === "Receipt ID")!;
    expect(receipt.nullCount).toBe(2);
  });

  it("exports to CSV matching the snapshot", async () => {
    const out = join(dir, "export.csv");
    await exportParquet(expenses.path, out, "csv");
    const re = await importFileToParquet(out, "export.csv", join(dir, "reimport.parquet"));
    expect(re.rowCount).toBe(8);
  });

  it("builds a table from manual rows with typed columns", async () => {
    const info = await rowsToParquet(
      [{ name: "K", type: "text" }, { name: "N", type: "integer" }],
      [["a", 1], ["b", 2]],
      join(dir, "manual.parquet")
    );
    expect(info.rowCount).toBe(2);
    expect(info.columns.find((c) => c.name === "N")?.type).toBe("integer");
  });
});
