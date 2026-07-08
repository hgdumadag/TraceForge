/** Chart node output tests: aggregation, ordering per chart type, top-N. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importFileToParquet, executeTabularNode, previewParquet, type TabularInput, type TabularNodeContext } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
let dir: string;
let expenses: TabularInput;

function ctx(config: Record<string, unknown>): TabularNodeContext {
  return {
    nodeType: "chart",
    nodeLabel: "Chart",
    config,
    inputs: { input: [expenses] },
    parameterDefinitions: [],
    parameterValues: {},
    outputPathFor: (h) => join(dir, `chart_${h}_${Math.random().toString(36).slice(2)}.parquet`)
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "tf-chart-"));
  const imp = await importFileToParquet(join(here, "fixtures/expenses.csv"), "expenses.csv", join(dir, "expenses.parquet"));
  expenses = { path: join(dir, "expenses.parquet"), columns: imp.columns, rowCount: imp.rowCount };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("chart node", () => {
  it("bar: aggregates and orders by value descending", async () => {
    const r = await executeTabularNode(ctx({ chartType: "bar", dimension: "Employee Name", measure: "Amount in USD", aggregate: "sum" }));
    const out = r.outputs[0];
    expect(out.columns.map((c) => c.name)).toEqual(["Dimension", "Value"]);
    const rows = (await previewParquet(out.path, 20)).rows;
    expect(rows.length).toBe(5); // five distinct employees
    const values = rows.map((row) => Number(row.Value));
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    // Ben Cruz has two 1200.50 hotel lines → tops the chart.
    expect(rows[0].Dimension).toBe("Ben Cruz");
    expect(values[0]).toBeCloseTo(2401.0);
  });

  it("line: orders by dimension ascending (sequences read left to right)", async () => {
    const r = await executeTabularNode(ctx({ chartType: "line", dimension: "Date Expense Incurred", measure: "Amount in USD", aggregate: "sum" }));
    const rows = (await previewParquet(r.outputs[0].path, 20)).rows;
    const dims = rows.map((row) => String(row.Dimension));
    expect([...dims].sort()).toEqual(dims);
  });

  it("top-N keeps the largest categories", async () => {
    const r = await executeTabularNode(ctx({ chartType: "pie", dimension: "Employee Name", measure: "Amount in USD", aggregate: "sum", topN: 2 }));
    const rows = (await previewParquet(r.outputs[0].path, 20)).rows;
    expect(rows.length).toBe(2);
    expect(rows.map((row) => row.Dimension)).toEqual(["Ben Cruz", "Eva Tan"]);
  });

  it("top-N on line charts preserves dimension order after selection", async () => {
    const r = await executeTabularNode(ctx({ chartType: "area", dimension: "Date Expense Incurred", measure: "Amount in USD", aggregate: "sum", topN: 3 }));
    const rows = (await previewParquet(r.outputs[0].path, 20)).rows;
    expect(rows.length).toBe(3);
    const dims = rows.map((row) => String(row.Dimension));
    expect([...dims].sort()).toEqual(dims);
  });

  it("count aggregate works for frequency charts", async () => {
    const r = await executeTabularNode(ctx({ chartType: "donut", dimension: "Employee ID", measure: "Expense ID", aggregate: "count" }));
    const rows = (await previewParquet(r.outputs[0].path, 20)).rows;
    const total = rows.reduce((s, row) => s + Number(row.Value), 0);
    expect(total).toBe(8);
  });
});
