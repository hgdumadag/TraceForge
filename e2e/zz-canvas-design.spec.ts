/** E2E: canvas redesign (design "Audit Canvas Options" 1A/1B) — node cards, toolbox,
 * save-state indicator, sticky notes, and both themes.
 * Named zz- so it runs after the lifecycle suite (catalog empty-state needs a pristine app). */
import { test, expect } from "@playwright/test";

test("redesigned canvas: node cards, toolbox, save state, note, themes", async ({ page, request }) => {
  const created = await (await request.post("/api/workflows", { data: { name: "Canvas Design E2E" } })).json();
  await page.goto(`/#/workflows/${created.workflow.id}`);

  // Toolbox: search field and icon'd, counted categories.
  await expect(page.locator(".palette-search input")).toHaveAttribute("placeholder", "Search tools…");
  const importHeader = page.locator(".palette h4", { hasText: "Import" });
  await expect(importHeader.locator(".count")).toHaveText("4");
  await expect(page.locator(".palette-item .palette-icon svg").first()).toBeVisible();

  // Sticky note gets the NOTE header (annotations aren't config-validated, so this
  // also gives us a save that succeeds — a workflow node would need real config first).
  await page.locator(".palette-item", { hasText: "Sticky note" }).click();
  await expect(page.locator(".tf-note .tf-note-head", { hasText: "NOTE" })).toBeVisible();

  // Save-state indicator flips dirty → saved.
  await expect(page.locator(".save-state.dirty")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".save-state.saved")).toBeVisible();

  // Add a node from the palette → redesigned card appears.
  await page.locator(".palette-item", { hasText: "Import File" }).click();
  const node = page.locator(".tf-node", { hasText: "Import File" });
  await expect(node).toBeVisible();
  await expect(node.locator(".node-chip svg")).toBeVisible();
  await expect(node.locator(".node-cat")).toContainText("IMPORT");

  // Both themes render the redesigned node (toggle lives in the sidebar, which is
  // auto-collapsed while editing a workflow — expand it first).
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator(".theme-toggle").click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await expect(node.locator(".node-chip svg")).toBeVisible();
});
