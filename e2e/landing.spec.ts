/** Landing page at "#/": introduces the app and links into the real app shell. */
import { test, expect } from "@playwright/test";

test("landing page is the entry route and links into the workflow catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open Workflows" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Open Workflows" }).first().click();
  await expect(page).toHaveURL(/#\/workflows$/);
  await expect(page.getByRole("heading", { name: "Workflow Catalog" })).toBeVisible();
});

test("sidebar logo navigates back to the landing page", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("button", { name: "TraceForge" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("button", { name: "Open Workflows" }).first()).toBeVisible();
});
