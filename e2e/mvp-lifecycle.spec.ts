/**
 * Browser E2E for the MVP lifecycle (gates.md §12, project.md §11):
 * create → build → run → preview → history → verify → activate → publish → clone.
 * Runs serially against one app instance with a fresh data dir (scripts/e2e-server.mjs).
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const WF_NAME = "T&E E2E Test";

/** Select an option in a labeled field (label.field wraps its control). */
function field(page: Page, labelText: string | RegExp): Locator {
  return page.locator("label.field", { hasText: labelText });
}

async function chooseDataset(page: Page, paramLabel: string | RegExp, optionText: string | RegExp) {
  const select = field(page, paramLabel).locator("select");
  const value = await select.locator("option", { hasText: optionText }).first().getAttribute("value");
  expect(value, `dataset option matching ${optionText}`).toBeTruthy();
  await select.selectOption(value!);
}

async function fillRunParameters(page: Page) {
  await chooseDataset(page, "Employee Expense Listing", /Sample — Employee Expense Listing/);
  // Threshold/keyword parameters are pre-filled from template defaults.
}

test("catalog shows empty state and blank creation validates the name", async ({ page }) => {
  await page.goto("/#/workflows");
  await expect(page.getByRole("heading", { name: "Workflow Catalog" })).toBeVisible();
  await expect(page.getByText("No workflows yet")).toBeVisible();

  await page.getByRole("button", { name: "+ Workflow" }).click();
  const createButton = page.getByRole("button", { name: "Create workflow" });
  await expect(createButton).toBeDisabled(); // name required
  await field(page, "Name").locator("input").fill("Blank Smoke");
  await createButton.click();
  await expect(page).toHaveURL(/#\/workflows\//);
  await expect(page.locator(".badge.draft").first()).toBeVisible();
});

test("clone the Travel & Expense template with preview details", async ({ page }) => {
  await page.goto("/#/templates");
  const card = page.locator(".card", { hasText: "Travel & Expense Testing" });
  await card.getByRole("button", { name: "Preview & clone" }).click();

  // Preview shows audit metadata before cloning (features/template-library.md §2.2).
  await expect(page.getByText("Risk addressed")).toBeVisible();
  await expect(page.getByText("receipt_threshold")).toBeVisible();

  await field(page, "New workflow name").locator("input").fill(WF_NAME);
  await page.getByRole("button", { name: "Clone template" }).click();

  await expect(page).toHaveURL(/#\/workflows\//);
  await expect(page.locator(".tf-node", { hasText: "Import Expense Listing" })).toBeVisible();
  await expect(page.locator(".tf-node", { hasText: "Expense Policy Validations" })).toBeVisible();
  await expect(page.locator(".badge.draft").first()).toBeVisible();
});

test("run the workflow: live node statuses, output preview, exceptions", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("cell", { name: WF_NAME }).click();

  await page.getByRole("button", { name: "▶ Run" }).click();
  await fillRunParameters(page);
  await page.getByRole("button", { name: "Run workflow" }).click();

  // Node statuses stream onto the canvas; all three nodes end succeeded.
  const validateNode = page.locator(".tf-node", { hasText: "Expense Policy Validations" });
  await expect(validateNode.locator(".badge.succeeded")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".tf-node .badge.succeeded")).toHaveCount(3, { timeout: 30000 });

  // Preview the validate node's exceptions output.
  await validateNode.click();
  await page.getByRole("button", { name: "Preview: exceptions" }).click();
  const drawer = page.locator(".preview-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("columnheader", { name: /^Validation/ })).toBeVisible();
  await expect(drawer.getByText(/rows total/)).toBeVisible();
});

test("run history records the execution with node results and evidence", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("cell", { name: WF_NAME }).click();
  await page.getByRole("button", { name: "Run History" }).click();

  const row = page.locator("table.grid tbody tr").filter({ has: page.locator(".badge.succeeded") }).first();
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByText(/^Execution exec_/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Evidence (Markdown)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Evidence (JSON)" })).toBeVisible();
  // All three nodes recorded.
  await expect(page.getByRole("cell", { name: /Expense Policy Validations/ })).toBeVisible();
});

test("verification: submit, tester/reviewer, sample run, pass", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("cell", { name: WF_NAME }).click();

  // Submit for review from the Versions tab.
  await page.getByRole("button", { name: "Versions" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator("table.grid .badge.in_review")).toBeVisible();

  // Record tester and reviewer.
  await page.getByRole("button", { name: "Verification" }).click();
  await field(page, "Tester").locator("input").fill("George D.");
  await field(page, "Reviewer").locator("input").fill("Audit Manager");
  await field(page, "Testing performed").locator("textarea").fill("Sample run over built-in expense data; reviewed all four validations.");
  await page.getByRole("button", { name: "Save details" }).click();

  // Sample run linked to the verification record.
  await page.getByRole("button", { name: "Run sample" }).click();
  await fillRunParameters(page);
  await page.getByRole("button", { name: "Start sample run" }).click();
  await expect(page.getByText(/Linked sample run/)).toBeVisible();
  await page.waitForTimeout(2500); // sample execution completes server-side

  await field(page, "Decision notes").locator("textarea").fill("Logic and outputs verified against sample data.");
  await page.getByRole("button", { name: "Pass — mark verified" }).click();

  await expect(page.locator(".page > .row .badge.verified").first()).toBeVisible({ timeout: 15000 });
});

test("only verified versions activate; activation marks the workflow active", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("cell", { name: WF_NAME }).click();
  await page.getByRole("button", { name: "Versions" }).click();

  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.locator("table.grid .badge.active").first()).toBeVisible();

  // Catalog reflects the active version and verification status.
  await page.goto("/#/workflows");
  const row = page.locator("tr", { hasText: WF_NAME });
  await expect(row.locator(".badge.verified")).toBeVisible();
  await expect(row.getByText("v1")).toBeVisible();
});

test("publish to toolkit and clone the published tool to a new draft", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("cell", { name: WF_NAME }).click();
  await page.getByRole("button", { name: "Versions" }).click();

  await page.getByRole("button", { name: "Publish to toolkit" }).click();
  await field(page, "Risk addressed").locator("textarea").fill("Inappropriate or unsupported T&E spend.");
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  await page.goto("/#/toolkit");
  const tool = page.locator(".card", { hasText: WF_NAME });
  await expect(tool.locator(".badge.published")).toBeVisible();

  await tool.getByRole("button", { name: "Clone to draft" }).click();
  await expect(page).toHaveURL(/#\/workflows\//);
  await expect(page.locator(".badge.draft").first()).toBeVisible();
  await expect(page.locator(".tf-node", { hasText: "Expense Policy Validations" })).toBeVisible();
});

test("editing an active version creates a new draft instead of mutating it", async ({ page }) => {
  await page.goto("/#/workflows");
  await page.getByRole("cell", { name: WF_NAME, exact: true }).click();

  // Active version is read-only on the canvas.
  await expect(page.getByText(/read-only \(create a draft to edit\)/)).toBeVisible();
  await page.getByRole("button", { name: /Create draft from v1/ }).click();
  await expect(page.locator(".page > .row .badge.draft").first()).toBeVisible();
  await expect(page.getByText(/^v2/).first()).toBeVisible();
});

test("guide page renders navigation help and sample expressions", async ({ page }) => {
  await page.goto("/#/guide");
  await expect(page.getByRole("heading", { name: "TraceForge User Guide" })).toBeVisible();
  await expect(page.getByText("{param!receipt_threshold}").first()).toBeVisible();
  await expect(page.getByText("days_between(d1, d2)")).toBeVisible();
  // Node reference is generated from the registry.
  await expect(page.locator(".card", { hasText: "uses expressions" }).first()).toBeVisible();
});
