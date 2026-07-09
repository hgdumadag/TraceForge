# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a marketing-style landing page at `#/` that introduces TraceForge, moving the existing Workflow Catalog to `#/workflows`, per `docs/superpowers/specs/2026-07-09-landing-page-design.md`.

**Architecture:** `App.tsx`'s hash router gets one new top-level branch: when `hash === "#/"`, render a new standalone `LandingPage` component (no sidebar). Every other hash keeps rendering inside the existing sidebar shell, with the Workflow Catalog now living at `#/workflows` instead of `#/`. The landing page itself is static content — no new state, no new API calls, no new dependencies.

**Tech Stack:** React + TypeScript (Vite), plain CSS with existing custom properties, Playwright for e2e (this codebase has no unit-test harness for `apps/web` — UI behavior is verified exclusively via the Playwright suite in `e2e/`, run against a production build).

## Global Constraints

- No new npm dependencies. The hero illustration is plain HTML/CSS/SVG, not React Flow.
- No `localStorage` "seen it once" logic — the landing page renders every time `#/` is hit.
- Landing page copy (headline, subhead, feature-card titles/descriptions, footer) must match the mockup verbatim, as specified in the design doc.
- All new styling must reuse existing CSS custom properties from `styles.css` (`--bg`, `--bg-panel`, `--bg-panel-2`, `--accent`, `--accent-2`, `--border`, `--text`, `--text-dim`, `--tint-blue-bg`, `--radius`) — no new hex/oklch color literals.
- e2e tests run against a **build**, not the dev server: `npm run build` must be run before `npx playwright test`, per `playwright.config.ts`'s `webServer` (`node scripts/e2e-server.mjs`, serving `apps/api/dist`).

---

### Task 1: Routing scaffold — move the Catalog to `#/workflows`, add a landing stub

**Files:**
- Create: `apps/web/src/landing.tsx`
- Create: `e2e/landing.spec.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `e2e/mvp-lifecycle.spec.ts` (8 occurrences)

**Interfaces:**
- Produces: `export function LandingPage({ navigate }: { navigate: (h: string) => void })` in `apps/web/src/landing.tsx` — consumed by `App.tsx`. Task 2 replaces this component's body but keeps the exact same signature.

- [ ] **Step 1: Write the failing e2e test for the new route split**

Create `e2e/landing.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test e2e/landing.spec.ts`
Expected: FAIL — `/` currently renders the Workflow Catalog directly (no "Open Workflows" button exists yet, and the sidebar logo isn't a button).

- [ ] **Step 3: Create the landing page stub**

Create `apps/web/src/landing.tsx`:

```tsx
/** Marketing-style entry screen shown at "#/", before the app shell. Full content lands in a follow-up task. */
export function LandingPage({ navigate }: { navigate: (h: string) => void }) {
  return (
    <div className="landing">
      <h1>TraceForge</h1>
      <button className="primary" onClick={() => navigate("#/workflows")}>Open Workflows</button>
    </div>
  );
}
```

- [ ] **Step 4: Wire the new route into `App.tsx`**

Modify `apps/web/src/App.tsx`. Add the import (after the `GuidePage` import):

```tsx
import { GuidePage } from "./guide";
import { LandingPage } from "./landing";
```

Replace the `nav` array's first entry — change:

```tsx
  const nav = [
    { hash: "#/", label: "Workflows" },
```

to:

```tsx
  const nav = [
    { hash: "#/workflows", label: "Workflows" },
```

Replace the active-link check inside the `nav.map` — change:

```tsx
            className={`navlink ${hash === n.hash || (n.hash === "#/" && workflowMatch) ? "active" : ""}`}
```

to:

```tsx
            className={`navlink ${hash === n.hash || (n.hash === "#/workflows" && workflowMatch) ? "active" : ""}`}
```

Replace the logo `div` — change:

```tsx
          <div className="logo">Trace<span>Forge</span></div>
```

to:

```tsx
          <button className="logo logo-link" onClick={() => navigate("#/")}>Trace<span>Forge</span></button>
```

(Keep the `logo` class alongside the new `logo-link` class — `landing.tsx` in Task 2 also renders a plain, non-interactive `<div className="logo">` for its own header, so the `.logo` typography rule must keep existing for both.)

Add the early-return landing branch right after the `sidebarCollapsed` effect and before the `const nav = [...]` line:

```tsx
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    if (workflowId) setSidebarCollapsed(true);
  }, [workflowId]);

  if (hash === "#/") {
    return <LandingPage navigate={navigate} />;
  }

  const nav = [
```

The rest of `App.tsx` (the `main`/`workflowMatch`/`hash === "#/templates"`/etc. ternary chain, ending in the `CatalogPage` fallback) is unchanged — `CatalogPage` naturally becomes the view for `#/workflows` (and any other unmatched hash) since `#/` now returns early above.

- [ ] **Step 5: Add a `.logo-link` style that layers button-reset rules onto the existing `.logo` look**

Modify `apps/web/src/styles.css`. The sidebar button keeps the `logo` class (Step 4), so its typography is unaffected — this step only adds the button-reset additions via a new `.logo-link` rule, placed right after the existing `.logo span` rule:

```css
.logo { font-weight: 700; font-size: 17px; padding: 4px 10px 14px; letter-spacing: 0.3px; white-space: nowrap; }
.logo span { color: var(--accent); }
.logo-link { background: none; border: none; color: var(--text); cursor: pointer; text-align: left; font-family: inherit; }
```

`.sidebar.collapsed .logo, .sidebar.collapsed .navlink, .sidebar.collapsed .foot { display: none; }` (further up in the file) needs no change — the sidebar button still carries the `logo` class, so it's still hidden on collapse.

Add a minimal placeholder rule for the new `.landing` stub at the end of the file (Task 2 replaces this with the full styling):

```css
.landing { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
```

- [ ] **Step 6: Fix the existing e2e suite's navigation to the moved Catalog route**

Modify `e2e/mvp-lifecycle.spec.ts`. The Workflow Catalog is no longer at `/`; it's at `/#/workflows`. Replace **all 8** occurrences of the exact line:

```ts
  await page.goto("/");
```

with:

```ts
  await page.goto("/#/workflows");
```

(Use a find-and-replace-all across the file — every occurrence of this exact line needs the same fix; the surrounding test logic is untouched. Lines `44`, `152`, and `174` already navigate to other explicit routes like `/#/templates` and are not affected.)

- [ ] **Step 7: Run the e2e suite to verify it passes**

Run: `npm run build && npx playwright test e2e/landing.spec.ts e2e/mvp-lifecycle.spec.ts`
Expected: PASS — all tests in both files green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/landing.tsx apps/web/src/App.tsx apps/web/src/styles.css e2e/landing.spec.ts e2e/mvp-lifecycle.spec.ts
git commit -m "feat(web): move workflow catalog to #/workflows, add landing route stub"
```

---

### Task 2: Full landing page content and styling

**Files:**
- Modify: `apps/web/src/landing.tsx` (replace stub body)
- Modify: `apps/web/src/styles.css` (replace placeholder `.landing` rule with full styling)
- Modify: `e2e/landing.spec.ts` (extend with content assertions)

**Interfaces:**
- Consumes: `LandingPage({ navigate })` signature from Task 1 — unchanged.
- Produces: nothing further consumed by other tasks; this is the last task in the plan.

- [ ] **Step 1: Extend the e2e test with real content assertions**

Replace the full contents of `e2e/landing.spec.ts` with:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npx playwright test e2e/landing.spec.ts`
Expected: FAIL — the stub `LandingPage` only has an `<h1>TraceForge</h1>` and one button; none of the new copy or the Guide link exist yet.

- [ ] **Step 3: Implement the full landing page**

Replace the full contents of `apps/web/src/landing.tsx`:

```tsx
/** Marketing-style entry screen shown at "#/", before the app shell. */
export function LandingPage({ navigate }: { navigate: (h: string) => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="logo">Trace<span>Forge</span></div>
        <nav className="landing-nav-links">
          <a href="#features-section">Features</a>
          <a href="#features-section">How it works</a>
          <button className="link-btn" onClick={() => navigate("#/guide")}>Guide</button>
        </nav>
        <button className="primary" onClick={() => navigate("#/workflows")}>Open Workflows</button>
      </header>

      <section className="landing-hero">
        <span className="landing-badge">Local-first · your data never leaves this machine</span>
        <h1>Audit analytics you can build, trust, and reuse.</h1>
        <p className="landing-subhead">
          No scripts, no formulas to babysit. Connect steps on a canvas to test a population, verify the logic
          once, then run it again next quarter with one click.
        </p>
        <div className="landing-cta">
          <button className="primary" onClick={() => navigate("#/workflows")}>Open Workflows</button>
          <a href="#features-section" className="btn">See how it works</a>
        </div>

        <div className="landing-illustration" aria-hidden="true">
          <svg className="landing-illustration-lines" viewBox="0 0 600 120" preserveAspectRatio="none">
            <path d="M180 60 H240" stroke="var(--border)" strokeWidth="2" fill="none" />
            <path d="M360 60 H420" stroke="var(--border)" strokeWidth="2" fill="none" />
          </svg>
          <div className="landing-illustration-card">
            <div className="landing-illustration-kind">Import</div>
            <div>Payroll Register</div>
          </div>
          <div className="landing-illustration-card accent">
            <div className="landing-illustration-kind">Merge · Join</div>
            <div>Match to HR Master</div>
          </div>
          <div className="landing-illustration-card">
            <div className="landing-illustration-kind">Transform</div>
            <div>Unknown / Terminated</div>
          </div>
        </div>
      </section>

      <section className="landing-features" id="features-section">
        <div className="landing-feature-card">
          <div className="landing-feature-icon">⚿</div>
          <h3>A canvas, not code</h3>
          <p>Drag out import, merge, and transform steps and connect them by hand. If you can describe the test in plain language, you can build it here.</p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon">✓</div>
          <h3>Verify once, trust always</h3>
          <p>Lock a workflow once its logic checks out. Verified versions can't drift, so everyone downstream knows exactly what they're relying on.</p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon">↻</div>
          <h3>Build once, run forever</h3>
          <p>Every quarter, every client, every new dataset — reuse the same workflow instead of rebuilding the test from scratch.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <span>Local-first audit analytics. Data stays on this machine.</span>
        <span className="landing-footer-word">TraceForge</span>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Replace the placeholder `.landing` style with the full stylesheet**

Modify `apps/web/src/styles.css`. Replace the placeholder line added in Task 1:

```css
.landing { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
```

with:

```css
.landing { min-height: 100%; display: flex; flex-direction: column; }
.landing-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px; border-bottom: 1px solid var(--border);
}
.landing-nav-links { display: flex; align-items: center; gap: 20px; }
.landing-nav-links a, .landing-nav-links .link-btn { color: var(--text-dim); font-size: 14px; }
.landing-nav-links a:hover, .landing-nav-links .link-btn:hover { color: var(--text); text-decoration: none; }
.link-btn { background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; }

.landing-hero {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 56px 24px 40px; gap: 16px;
}
.landing-badge {
  display: inline-block; background: var(--tint-blue-bg); color: var(--accent);
  border: 1px solid var(--accent-2); border-radius: 20px; padding: 4px 14px; font-size: 12px; font-weight: 600;
}
.landing-hero h1 { font-size: 34px; margin: 0; max-width: 620px; line-height: 1.25; }
.landing-subhead { color: var(--text-dim); max-width: 560px; font-size: 15px; line-height: 1.5; margin: 0; }
.landing-cta { display: flex; gap: 10px; margin-top: 4px; }
.landing-cta .btn { padding: 7px 13px; border-radius: 6px; border: 1px solid var(--border); }

.landing-illustration {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 60px;
  margin-top: 32px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 32px 40px; width: 100%; max-width: 700px;
}
.landing-illustration-lines { position: absolute; inset: 0; width: 100%; height: 100%; }
.landing-illustration-card {
  position: relative; background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 14px; font-size: 13px; min-width: 140px; text-align: left;
}
.landing-illustration-card.accent { border-color: var(--accent-2); }
.landing-illustration-kind { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }

.landing-features {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
  padding: 40px 32px; max-width: 1000px; margin: 0 auto; width: 100%;
}
.landing-feature-card {
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px;
}
.landing-feature-icon {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; background: var(--bg-panel-2); color: var(--accent); margin-bottom: 10px;
}
.landing-feature-card h3 { margin: 0 0 6px; font-size: 15px; }
.landing-feature-card p { margin: 0; color: var(--text-dim); font-size: 13px; line-height: 1.5; }

.landing-footer {
  margin-top: auto; display: flex; justify-content: space-between; align-items: center;
  padding: 16px 32px; border-top: 1px solid var(--border); color: var(--text-dim); font-size: 12px;
}
.landing-footer-word { font-weight: 700; }
```

- [ ] **Step 5: Run the e2e suite to verify it passes**

Run: `npm run build && npx playwright test e2e/landing.spec.ts`
Expected: PASS — all four tests green.

- [ ] **Step 6: Run the full e2e suite once to confirm no regressions**

Run: `npm run build && npx playwright test`
Expected: PASS — every spec file (`landing.spec.ts`, `mvp-lifecycle.spec.ts`, `zz-canvas-design.spec.ts`, `zz-canvas-live.spec.ts`, `zz-chart.spec.ts`) green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/landing.tsx apps/web/src/styles.css e2e/landing.spec.ts
git commit -m "feat(web): full landing page content — hero, illustration, feature cards"
```
