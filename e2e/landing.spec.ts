/** Landing page at "#/": introduces the app and links into the real app shell. */
import { test, expect } from "@playwright/test";

test("landing page shows the pitch, illustration, and feature cards", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Audit analytics you can build, trust, and reuse." })).toBeVisible();
  await expect(page.getByText("Local-first · your data never leaves this machine")).toBeVisible();
  await expect(page.getByText(/No scripts, no formulas to babysit/)).toBeVisible();

  // Static hero illustration.
  await expect(page.getByText("Payroll Register")).toBeVisible();
  await expect(page.getByText("Match to HR Master")).toBeVisible();
  await expect(page.getByText("Unknown / Terminated")).toBeVisible();

  // Feature cards.
  await expect(page.getByRole("heading", { name: "A canvas, not code" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verify once, trust always" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build once, run forever" })).toBeVisible();

  await expect(page.getByText("Local-first audit analytics. Data stays on this machine.")).toBeVisible();
});

test("landing page links into the workflow catalog", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Workflows" }).first().click();
  await expect(page).toHaveURL(/#\/workflows$/);
  await expect(page.getByRole("heading", { name: "Workflow Catalog" })).toBeVisible();
});

test("landing page Guide link opens the real guide inside the app shell", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Guide" }).click();
  await expect(page.getByRole("heading", { name: "TraceForge User Guide" })).toBeVisible();
});

test("sidebar logo navigates back to the landing page", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("button", { name: "TraceForge" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "Audit analytics you can build, trust, and reuse." })).toBeVisible();
});

test("Features link scrolls to the feature section without leaving the landing page", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "A canvas, not code" })).toBeInViewport();
});

test("How it works link scrolls to the feature section without leaving the landing page", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "A canvas, not code" })).toBeInViewport();
});

test("See how it works link scrolls to the feature section without leaving the landing page", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "A canvas, not code" })).toBeInViewport();
});
