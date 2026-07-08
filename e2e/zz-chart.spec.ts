/** E2E: the Chart node renders an actual SVG chart in the output preview.
 * Named zz- so it runs after the lifecycle suite (the catalog empty-state test needs a pristine app). */
import { test, expect } from "@playwright/test";

test("chart node renders an SVG chart above the aggregated table", async ({ page, request }) => {
  // Build a small workflow through the API: sample expenses → donut chart.
  const samples = await (await request.get("/api/samples")).json();
  const expenseSample = samples.find((s: any) => s.name.includes("Expense Listing"));
  expect(expenseSample).toBeTruthy();

  const created = await (
    await request.post("/api/workflows", { data: { name: "Chart E2E" } })
  ).json();
  const graph = {
    nodes: [
      { id: "imp", type: "import_sample", label: "Import Expenses", position: { x: 0, y: 100 }, config: { sampleId: expenseSample.id } },
      {
        id: "cht",
        type: "chart",
        label: "Spend by Employee",
        position: { x: 320, y: 100 },
        config: { chartType: "donut", dimension: "Employee Name", measure: "Amount in USD", aggregate: "sum" }
      }
    ],
    edges: [{ id: "e1", source: "imp", sourceHandle: "output", target: "cht", targetHandle: "input" }],
    annotations: []
  };
  const saved = await request.put(`/api/versions/${created.version.id}`, { data: { graph } });
  expect(saved.ok()).toBeTruthy();

  // Run it through the UI and preview the chart output.
  await page.goto(`/#/workflows/${created.workflow.id}`);
  await page.getByRole("button", { name: "▶ Run" }).click();
  await page.getByRole("button", { name: "Run workflow" }).click();

  const chartNode = page.locator(".tf-node", { hasText: "Spend by Employee" });
  await expect(chartNode.locator(".badge.succeeded")).toBeVisible({ timeout: 30000 });

  await chartNode.click();
  await page.getByRole("button", { name: "Preview: output" }).click();

  const chart = page.locator(".chart-view svg");
  await expect(chart).toBeVisible();
  // Donut renders one slice per employee plus a legend; spot-check a legend entry.
  await expect(page.locator(".chart-view")).toContainText("Ben Cruz");
  // The aggregated table still shows below the chart.
  await expect(page.locator(".preview-drawer").getByRole("columnheader", { name: /Dimension/ })).toBeVisible();
});
