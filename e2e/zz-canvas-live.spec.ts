/** E2E: live data-flow surfaces after a run — node stats lines, edge row labels,
 * rows-in-play summary, and inspector row chips.
 * Named zz- so it runs after the lifecycle suite. */
import { test, expect } from "@playwright/test";

test("run populates node stats, edge labels, rows-in-play, and inspector chips", async ({ page, request }) => {
  const samples = await (await request.get("/api/samples")).json();
  const expenseSample = samples.find((s: any) => s.name.includes("Expense Listing"));
  expect(expenseSample).toBeTruthy();

  const created = await (await request.post("/api/workflows", { data: { name: "Canvas Live E2E" } })).json();
  const graph = {
    nodes: [
      { id: "imp", type: "import_sample", label: "Import Expenses", position: { x: 0, y: 100 }, config: { sampleId: expenseSample.id } },
      { id: "smp", type: "sample", label: "First Rows", position: { x: 340, y: 100 }, config: { mode: "first", rows: 5 } }
    ],
    edges: [{ id: "e1", source: "imp", sourceHandle: "output", target: "smp", targetHandle: "input" }],
    annotations: []
  };
  const saved = await request.put(`/api/versions/${created.version.id}`, { data: { graph } });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/#/workflows/${created.workflow.id}`);
  await page.getByRole("button", { name: "▶ Run" }).click();
  await page.getByRole("button", { name: "Run workflow" }).click();

  const sampleNode = page.locator(".tf-node", { hasText: "First Rows" });
  await expect(sampleNode.locator(".badge.succeeded")).toBeVisible({ timeout: 30000 });

  // Node stats line: sample node kept 5 rows.
  await expect(sampleNode.locator(".node-stats")).toContainText("5 rows");

  // Edge label shows the source node's output rows.
  await expect(page.locator(".react-flow__edge-text").first()).toContainText(/rows/);

  // Action-bar summary counts the import node's rows across 2 steps.
  await expect(page.locator(".rows-in-play")).toContainText(/rows in play across 2 steps/);

  // Inspector: selecting the node shows a preview button plus a row-count chip.
  await sampleNode.click();
  await expect(page.getByRole("button", { name: "Preview: output" })).toBeVisible();
  await expect(page.locator(".inspector .chip", { hasText: "5 rows" })).toBeVisible();
});
