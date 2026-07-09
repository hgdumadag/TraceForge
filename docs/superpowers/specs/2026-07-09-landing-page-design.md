# Landing Page — Design Spec

**Goal:** Give the app a marketing-style entry screen at `#/` that introduces TraceForge (what it is, its local-first premise, its three core value props) before the user drops into the working app, matching a provided mockup.

**Primary use case:** a first-time or returning user opens the app and lands on an informational page instead of being dropped straight into the Workflow Catalog table; they read a one-line pitch, see a small illustration of what a workflow looks like, and click through into the real app when ready.

## Non-goals (explicitly out of scope)

- Any first-visit / "seen it once" tracking. The landing page shows every time the app is opened at `#/` — no `localStorage` flag, no skip logic.
- A written "How it works" section with new step-by-step content. `Features` and `How it works` are two nav links pointing at the same single feature-cards section (two anchors, one section) — no additional prose to invent.
- Reusing the real canvas/node-card React Flow components for the hero illustration. The illustration is static decoration built from plain HTML/CSS + SVG connector lines, not a live canvas.
- Any change to the actual Workflow Catalog, Templates, Datasets, Toolkit, Settings, or Guide pages beyond the routing move described below.
- Responsive/mobile-specific layout work beyond what falls out naturally from flexbox/grid with `max-width`. This is a desktop-first internal tool.

## Routing changes (`src/App.tsx`)

Today `#/` renders `CatalogPage` directly inside the sidebar app shell. After this change:

- `#/` → new `LandingPage` component, rendered **outside** the sidebar shell (its own full-page layout, no `<nav className="sidebar">`).
- `#/workflows` → `CatalogPage` (moved from `#/`), inside the sidebar shell as today.
- The `nav` array's first entry changes from `{ hash: "#/", label: "Workflows" }` to `{ hash: "#/workflows", label: "Workflows" }`, and the sidebar's active-link check (`hash === n.hash || (n.hash === "#/" && workflowMatch)`) updates to check `"#/workflows"` instead of `"#/"`.
- `App`'s render branch gains a top-level check: if `hash === "#/"`, render `<LandingPage navigate={navigate} />` alone (no sidebar/main wrapper); otherwise render the existing sidebar + main layout with the `#/workflows` branch replacing the old default (`CatalogPage`) branch.
- The sidebar logo (`<div className="logo">Trace<span>Forge</span></div>`) becomes a `<button className="logo-link">` (or wraps in an unstyled button) that calls `navigate("#/")`, giving users already inside the app a way back to the landing page.

## New file: `src/landing.tsx`

`export function LandingPage({ navigate }: { navigate: (h: string) => void })`, following the existing page-component pattern (e.g. `CatalogPage` in `pages.tsx`).

Sections, top to bottom:

1. **Top bar** — logo (left); `Features`, `How it works` (both `<a href="#features-section">`-style anchor links, no `navigate()` needed since it's an in-page scroll), `Guide` (calls `navigate("#/guide")`) in the center/right; `Open Workflows` button (calls `navigate("#/workflows")`) far right.
2. **Hero** — small pill badge reading "Local-first · your data never leaves this machine"; headline "Audit analytics you can build, trust, and reuse."; subhead "No scripts, no formulas to babysit. Connect steps on a canvas to test a population, verify the logic once, then run it again next quarter with one click."; two CTA buttons: `Open Workflows` (primary, → `#/workflows`) and `See how it works` (secondary, scrolls to the feature section).
3. **Hero illustration** — a static row of three boxed "cards" (`Import — Payroll Register`, `Merge · Join — Match to HR Master`, `Transform — Unknown / Terminated`) connected by simple SVG lines, plain divs styled to echo (not reuse) the real node-card look.
4. **Feature cards** (`id="features-section"`, the anchor target for both `Features` and `How it works`) — three cards in a row, each with an icon glyph, title, and one-line description, copy taken verbatim from the mockup:
   - "A canvas, not code" — "Drag out import, merge, and transform steps and connect them by hand. If you can describe the test in plain language, you can build it here."
   - "Verify once, trust always" — "Lock a workflow once its logic checks out. Verified versions can't drift, so everyone downstream knows exactly what they're relying on."
   - "Build once, run forever" — "Every quarter, every client, every new dataset — reuse the same workflow instead of rebuilding the test from scratch."
5. **Footer strip** — "Local-first audit analytics. Data stays on this machine." on the left (matching the sidebar's existing footer copy) and the "TraceForge" wordmark on the right.

## Styling

- New rules appended to `src/styles.css`, scoped under a `.landing` root class to avoid colliding with `.app`/`.sidebar`/`.main`.
- Reuses existing CSS custom properties only — `--bg`, `--bg-panel`, `--bg-panel-2`, `--accent`, `--accent-2`, `--border`, `--text`, `--text-dim`, `--radius` — so the page follows the current dark/light theme automatically with no new color values.
- Buttons reuse the existing global `button` / `button.primary` styles already defined in `styles.css` rather than introducing new button classes.

## Design decisions log

- **Landing replaces `#/` rather than being a one-time splash or a bolt-on extra page** — the user confirmed they want it to behave like a real front door, shown on every visit, with the working app moved one level deeper to `#/workflows`.
- **No new "How it works" prose** — since the provided mockup screenshot doesn't show that section's body, we're not inventing content; both nav labels point at the same feature-card block until the user has actual "how it works" copy to add.
- **Static illustration over live canvas** — keeps the landing page a lightweight, dependency-free decoration rather than pulling React Flow and node/edge components into a marketing page where they'd never be interactive.
