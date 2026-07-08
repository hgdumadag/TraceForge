/** Python node integration tests (ADR-010: isolated process, untrusted code).
 * Skipped automatically when python3 is not installed. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importFileToParquet, runPythonNode, previewParquet, type TabularInput } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function pythonAvailable(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const maybe = pythonAvailable() ? describe : describe.skip;

maybe("python node", () => {
  let dir: string;
  let expenses: TabularInput;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-py-"));
    const imp = await importFileToParquet(join(here, "fixtures/expenses.csv"), "expenses.csv", join(dir, "expenses.parquet"));
    expenses = { path: join(dir, "expenses.parquet"), columns: imp.columns, rowCount: imp.rowCount };
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("transforms rows in an isolated process", async () => {
    const out = join(dir, "py-out.parquet");
    const result = await runPythonNode(
      expenses.path,
      `rows = [r for r in rows if float(r["Amount in USD"] or 0) > 500]`,
      out
    );
    expect(result.rowCount).toBe(4); // 1200.50 x2, 530, 950.75
    const preview = await previewParquet(out, 10);
    expect(preview.rows.every((r) => Number(r["Amount in USD"]) > 500)).toBe(true);
  });

  it("can add derived fields", async () => {
    const out = join(dir, "py-out2.parquet");
    const result = await runPythonNode(
      expenses.path,
      `
for r in rows:
    r["Flag"] = "HIGH" if float(r["Amount in USD"] or 0) > 1000 else "OK"
`,
      out
    );
    expect(result.columns.map((c) => c.name)).toContain("Flag");
  });

  it("surfaces Python errors without crashing the app", async () => {
    await expect(
      runPythonNode(expenses.path, `raise ValueError("bad audit logic")`, join(dir, "py-err.parquet"))
    ).rejects.toThrow(/bad audit logic|exit/);
  });

  it("rejects code that does not produce a row list", async () => {
    await expect(
      runPythonNode(expenses.path, `rows = 42`, join(dir, "py-bad.parquet"))
    ).rejects.toThrow(/list of dict rows|exit/);
  });

  it("does not leak host environment secrets into the sandbox", async () => {
    process.env.TF_SECRET_CANARY = "super_secret_do_not_leak";
    try {
      const out = join(dir, "py-env.parquet");
      await runPythonNode(
        expenses.path,
        `
import os
rows = [{"leaked": os.environ.get("TF_SECRET_CANARY", "ABSENT")}]
`,
        out
      );
      const preview = await previewParquet(out, 1);
      expect(preview.rows[0]?.leaked).toBe("ABSENT");
    } finally {
      delete process.env.TF_SECRET_CANARY;
    }
  });

  it("enforces the timeout", async () => {
    await expect(
      runPythonNode(expenses.path, `import time\ntime.sleep(30)`, join(dir, "py-slow.parquet"), 1500)
    ).rejects.toThrow();
  }, 15000);
});
