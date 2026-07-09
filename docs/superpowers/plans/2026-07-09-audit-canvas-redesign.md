# Audit Canvas Redesign (Design 1A/1B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle TraceForge's workflow canvas to match the approved "Audit Canvas Options" design (options 1A refined-dark + 1B professional-light) and surface live row-count data on nodes, edges, and the action bar.

**Architecture:** The app already has everything structural the design needs: a React Flow canvas (`apps/web/src/canvas.tsx`), a CSS-variable theme system with dark/light blocks (`apps/web/src/styles.css` + `theme.ts`), and per-node run summaries (`outputSummary` with `{rows, columns}` per output handle) already delivered to the browser over SSE. Phase 1 is a pure front-end restyle implemented once against CSS variables so both 1A (dark) and 1B (light) fall out of the existing theme toggle. Phase 2 wires the already-transmitted `outputSummary` data into node cards, edge labels, and an action-bar total. **No backend changes anywhere in this plan.**

**Tech Stack:** React 18, @xyflow/react (React Flow 12), plain CSS with custom properties, Playwright E2E.

**Design source:** claude.ai/design project `c0499d93-d272-4b38-9311-591ba0e652c0`, file `Audit Canvas Options.dc.html`. The relevant specs are transcribed below — implementers do not need access to the design file.

## Design reference (transcribed from the mockup)

Node card (target look):

```
┌────────────────────────────────┐
│ ┌────┐  IMPORT                 │   ← category tag: 10px mono, letter-spaced, category ink
│ │icon│  Import Payroll Register│   ← title: 13px, weight 600
│ └────┘  9,340 rows · 14 cols   │   ← stats: 11px, dim (Phase 2, from last run)
└────────────────────────────────┘
  ●  left edge: input port(s)   right edge: output port(s)  ●
```

- Icon chip: 30×30, radius 7, tinted background in the category hue, icon inked in the category hue.
- Selected node: 2px border in category ink + soft 3–4px glow ring of the same hue + drop shadow.
- Edges: 2px stroke, dashed, animated ("marching ants" flow), row-count label pill mid-edge (Phase 2).
- Toolbox: search box with magnifier icon, category group headers (uppercase, letter-spaced) with item counts, icon + label rows that highlight on hover (no boxed border).
- Action bar: primary "Save changes", "Validate" with a check icon, green-tinted "Run"; far right a dim summary "18,240 rows in play across 5 steps" (Phase 2).
- Header: breadcrumb + status pill + meta line (already exists); green-dot "All changes saved" indicator.
- Sticky note: dashed amber border, small "NOTE" mono header with lines icon.
- Category hues (oklch hue channel): Import 250 (blue), Clean 190 (teal), Merge 300 (purple), Transform 145 (green), Code 75 (amber), Visualize 340 (pink), Governance 230 (slate, low chroma), AI 315 (magenta).

## Scope decisions (confirmed defaults — flag to the user if they object)

1. **Options 1A + 1B only.** Option 1C ("structured stage lanes") is a different interaction paradigm and is deferred to Phase 3 (see end of plan) — not implemented here.
2. **Current tab structure kept.** The mockup folds the Versions tab into a header dropdown; we keep the existing Versions tab (it carries promote/review actions the mockup doesn't cover).
3. **No "+" quick-add port button.** The mockup's output-port "+" (click to append a connected node) is a new interaction — deferred to Phase 3.
4. **Existing E2E selector contracts are load-bearing** and must keep working: `.tf-node` (contains node label text and `.badge.<status>`), buttons named exactly `▶ Run`, `Run workflow`, `Validate`, `Save changes`, `Preview: <handle>`, and `label.field` wrapping form controls.

## Global Constraints

- Node ≥ 20; npm workspaces monorepo. Never edit files under `node_modules/`.
- Web app has **no unit-test runner** (root vitest covers `packages/*` only). Verification per task = TypeScript build; behavioral verification = Playwright E2E (`npm run test:e2e`), which tests the **built** app.
- Build command (typecheck + bundle): `npm run build -w @traceforge/web` — must pass with zero errors after every task.
- E2E command: `npm run build && npm run test:e2e` (full build first; the E2E server serves compiled output). Run where a task's step says so — not after every task.
- Do not change anything in `apps/api/`, `packages/`, or `e2e/mvp-lifecycle.spec.ts` / `e2e/zz-chart.spec.ts` (existing specs must pass unmodified).
- Preserve accessible names listed in scope decision 4 verbatim.
- CSS: use the existing custom-property pattern — every new color must be defined in **both** the `:root` (dark) and `:root[data-theme="light"]` blocks. `oklch()` and `color-mix()` are allowed (app targets current Chromium/Firefox/Safari).
- Every commit message: single imperative line, then trailer, e.g. `git commit -m "feat: ..." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`.

---

# Phase 1 — Visual system (1A dark + 1B light, restyle only)

### Task 1: Category color tokens and node icon library

**Files:**
- Modify: `apps/web/src/styles.css` (the `:root` block at lines ~1–31 and `:root[data-theme="light"]` block at lines ~36–63)
- Create: `apps/web/src/nodevisuals.tsx`

**Interfaces:**
- Produces: `catColor(category: string | undefined): { ink: string; bg: string }` returning CSS `var()` strings; `NodeIcon({ type, size = 16 }: { type: string; size?: number })` React component rendering a 24-viewBox stroke SVG for any node `type` from `@traceforge/domain`'s `NODE_TYPES` (plus `"__note"`); falls back to a generic square for unknown types. CSS tokens `--cat-<key>` / `--cat-<key>-bg` for keys `import, clean, merge, transform, code, visualize, governance, ai`, and `--edge`.

- [ ] **Step 1: Add tokens to the dark theme block**

In `apps/web/src/styles.css`, inside the first `:root { ... }` block, insert after the `--canvas-dot: #232b34;` line:

```css
  --edge: #4a5866;
  /* Category hues (design "Audit Canvas Options" 1A): ink = icon/label color, bg = icon chip fill. */
  --cat-import: oklch(75% 0.13 250);     --cat-import-bg: oklch(28% 0.05 250);
  --cat-clean: oklch(75% 0.11 190);      --cat-clean-bg: oklch(28% 0.05 190);
  --cat-merge: oklch(75% 0.13 300);      --cat-merge-bg: oklch(30% 0.06 300);
  --cat-transform: oklch(75% 0.12 145);  --cat-transform-bg: oklch(28% 0.05 145);
  --cat-code: oklch(78% 0.12 75);        --cat-code-bg: oklch(30% 0.05 75);
  --cat-visualize: oklch(75% 0.12 340);  --cat-visualize-bg: oklch(30% 0.05 340);
  --cat-governance: oklch(75% 0.06 230); --cat-governance-bg: oklch(28% 0.03 230);
  --cat-ai: oklch(75% 0.12 315);         --cat-ai-bg: oklch(30% 0.05 315);
```

- [ ] **Step 2: Add tokens to the light theme block**

Inside `:root[data-theme="light"] { ... }`, insert after the `--canvas-dot: #c8d2dd;` line:

```css
  --edge: #9fb0c0;
  /* Light theme (design 1B): darker inks for ≥4.5:1 contrast, pale chip fills. */
  --cat-import: oklch(45% 0.13 250);     --cat-import-bg: oklch(93% 0.03 250);
  --cat-clean: oklch(42% 0.10 190);      --cat-clean-bg: oklch(92% 0.03 190);
  --cat-merge: oklch(44% 0.14 300);      --cat-merge-bg: oklch(93% 0.04 300);
  --cat-transform: oklch(42% 0.12 145);  --cat-transform-bg: oklch(92% 0.03 145);
  --cat-code: oklch(45% 0.11 75);        --cat-code-bg: oklch(93% 0.04 75);
  --cat-visualize: oklch(45% 0.13 340);  --cat-visualize-bg: oklch(93% 0.03 340);
  --cat-governance: oklch(44% 0.06 230); --cat-governance-bg: oklch(93% 0.02 230);
  --cat-ai: oklch(45% 0.13 315);         --cat-ai-bg: oklch(93% 0.03 315);
```

- [ ] **Step 3: Create `apps/web/src/nodevisuals.tsx`**

```tsx
/** Per-category colors and per-node-type icons for the canvas redesign
 * (design source: "Audit Canvas Options" 1A/1B). Tokens live in styles.css. */

const CATEGORY_KEYS: Record<string, string> = {
  Import: "import",
  Clean: "clean",
  Merge: "merge",
  Transform: "transform",
  Code: "code",
  Visualize: "visualize",
  Governance: "governance",
  AI: "ai"
};

/** CSS var() pair for a node category; unknown categories fall back to Transform. */
export function catColor(category: string | undefined): { ink: string; bg: string } {
  const key = CATEGORY_KEYS[category ?? ""] ?? "transform";
  return { ink: `var(--cat-${key})`, bg: `var(--cat-${key}-bg)` };
}

/** 24-viewBox stroke icon paths, keyed by node type (plus "__note" for sticky notes). */
const ICON_PATHS: Record<string, string> = {
  import_file: "M12 4v10m0 0l-4-4m4 4l4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  import_api: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2",
  import_sample: "M4 5h16v14H4zM4 9h16",
  new_table: "M5 5h14v14H5zM9 9h6v6H9z",
  find_replace: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  text_to_columns: "M4 5h16M4 10h16M9 10v9M15 10v9",
  parse_json: "M9 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3",
  sample: "M5 6h14M5 10h14M5 14h8M5 18h4",
  validate: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4",
  join: "M6 4v6a4 4 0 0 0 4 4h4M6 20v-6M14 11l3 3-3 3",
  append: "M8 6v6a4 4 0 0 0 4 4h4M8 20V12M16 6l-3 3 3 3",
  add_columns: "M5 4h6v16H5zM15 9v6M12 12h6",
  edit_columns: "M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4",
  overwrite_columns: "M5 4h6v16H5zM14 12h6M17 9l3 3-3 3",
  select_columns: "M5 4h5v16H5zM14 4h5v16h-5z",
  filter: "M4 5h16l-6 8v5l-4 2v-7z",
  sort: "M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3",
  deduplicate: "M4 4h12v12H4zM8 8h12v12H8z",
  pivot: "M4 4h16v16H4zM4 10h16M10 10v10",
  unpivot: "M4 4h16v16H4zM10 4v16M4 10h6",
  python: "M8 5l-5 7 5 7M16 5l5 7-5 7",
  chart: "M5 20V10M11 20V4M17 20v-7M3 20h18",
  publish_toolkit: "M12 15V5M12 5l-4 4M12 5l4 4M5 19h14",
  llm_chat: "M4 5h16v11H9l-5 4z",
  explain_expression: "M9 9a3 3 0 1 1 4.2 2.7c-.9.4-1.2 1-1.2 2.3M12 17.5v.01",
  generate_test_logic: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  __note: "M4 6h16M4 12h10M4 18h7"
};

export function NodeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const d = ICON_PATHS[type] ?? "M4 4h16v16H4z";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0. (The new module is not imported yet; `tsc` still typechecks it.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/src/nodevisuals.tsx
git commit -m "feat(web): category color tokens and node icon library for canvas redesign" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Node card redesign

**Files:**
- Modify: `apps/web/src/canvas.tsx` (the `TfNode` component, lines ~30–67)
- Modify: `apps/web/src/styles.css` (the `.tf-node` rule group, lines ~220–229)

**Interfaces:**
- Consumes: `catColor`, `NodeIcon` from `./nodevisuals` (Task 1).
- Produces: `.tf-node` DOM structure `<div.tf-node><div.node-row><span.node-chip>…<div.node-body><div.node-cat>…<div.node-title>…` — Task 8 later inserts a `.node-stats` line into `.node-body`, and the Phase 1 E2E (Task 7) asserts `.node-chip svg` and `.node-cat`. Status badge stays a direct child `div.badge.<status>` inside `.tf-node` (existing E2E depends on it).

- [ ] **Step 1: Rewrite `TfNode` in `apps/web/src/canvas.tsx`**

Add to the imports at the top of the file:

```tsx
import { catColor, NodeIcon } from "./nodevisuals";
```

Replace the entire existing `TfNode` function with:

```tsx
function TfNode({ data, selected }: any) {
  const def = getNodeType(data.nodeType);
  const inputs = def?.inputs ?? [];
  const outputs = def?.outputs ?? [];
  const { ink, bg } = catColor(def?.category);
  return (
    <div
      className={`tf-node status-${data.status ?? "idle"} ${selected ? "selected" : ""}`}
      style={{ "--node-ink": ink, "--node-chip": bg } as any}
    >
      {inputs.map((p, i) => (
        <Handle
          key={p.name}
          type="target"
          id={p.name}
          position={Position.Left}
          style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%` }}
          title={p.name}
        />
      ))}
      <div className="node-row">
        <span className="node-chip">
          <NodeIcon type={data.nodeType} />
        </span>
        <div className="node-body">
          <div className="node-cat mono">
            {def ? `${def.category} · ${def.label}`.toUpperCase() : String(data.nodeType).toUpperCase()}
          </div>
          <div className="node-title">{data.label}</div>
          {inputs.length > 1 && <div className="node-ports-hint">{inputs.map((p) => p.name).join(" | ")}</div>}
          {outputs.length > 1 && <div className="node-ports-hint">→ {outputs.map((p) => p.name).join(" | ")}</div>}
        </div>
      </div>
      {data.status && data.status !== "idle" && <div className={`badge ${data.status}`} style={{ marginTop: 6 }}>{data.status}</div>}
      {outputs.map((p, i) => (
        <Handle
          key={p.name}
          type="source"
          id={p.name}
          position={Position.Right}
          style={{ top: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
          title={p.name}
        />
      ))}
    </div>
  );
}
```

(The old inline `background` styles on `Handle` are gone on purpose — ports are now styled by CSS below. The `as any` cast is needed because the object sets CSS custom properties, which `CSSProperties` doesn't type.)

- [ ] **Step 2: Replace the node CSS**

In `apps/web/src/styles.css`, replace this existing block:

```css
.tf-node {
  background: var(--bg-panel-2); border: 1.5px solid var(--border); border-radius: 8px;
  padding: 8px 12px; min-width: 150px; font-size: 12px; color: var(--text);
}
.tf-node .type { color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
```

with:

```css
.tf-node {
  --node-ink: var(--accent); --node-chip: var(--tint-blue-bg);
  background: var(--bg-panel-2); border: 1px solid var(--border); border-radius: 10px;
  padding: 11px 13px; min-width: 200px; max-width: 270px; font-size: 12px; color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.node-row { display: flex; gap: 10px; align-items: center; }
.node-chip {
  width: 30px; height: 30px; border-radius: 7px; background: var(--node-chip); color: var(--node-ink);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.node-body { min-width: 0; }
.node-cat { font-size: 9.5px; letter-spacing: 0.6px; color: var(--node-ink); }
.node-title { font-weight: 600; font-size: 13px; margin-top: 1px; }
.node-stats { font-size: 11px; color: var(--text-dim); margin-top: 1px; }
.node-ports-hint { font-size: 10px; color: var(--text-dim); margin-top: 1px; }
.tf-node .react-flow__handle {
  width: 11px; height: 11px; border-radius: 50%;
  background: var(--bg-panel-2); border: 1.5px solid var(--edge);
}
.tf-node .react-flow__handle-right { border-color: var(--node-ink); }
```

Then update the existing `.tf-node.selected` rule from `border-color: var(--accent);` to:

```css
.tf-node.selected {
  border-color: var(--node-ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--node-ink) 22%, transparent), 0 8px 20px rgba(0, 0, 0, 0.25);
}
```

Leave `.tf-node.status-running/succeeded/failed/skipped` rules untouched.

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Run existing E2E to prove selector contracts survived**

Run: `npm run build && npm run test:e2e`
Expected: all existing tests pass (they assert `.tf-node` text content and `.badge.succeeded` inside nodes — both preserved).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/canvas.tsx apps/web/src/styles.css
git commit -m "feat(web): redesign canvas node cards with category icon chips and styled ports" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Toolbox (palette) restyle

**Files:**
- Modify: `apps/web/src/canvas.tsx` (the `Palette` component, lines ~166–205)
- Modify: `apps/web/src/styles.css` (`.palette` rules, lines ~199–208)

**Interfaces:**
- Consumes: `catColor`, `NodeIcon` from `./nodevisuals`.
- Produces: DOM `.palette > .palette-search > input` and `.palette-item > .palette-icon` (asserted by Task 7's E2E). Behavior (click-to-add, search filter, readOnly dimming) unchanged.

- [ ] **Step 1: Rewrite the `Palette` component's JSX**

Replace the `return (...)` of `Palette` in `apps/web/src/canvas.tsx` with:

```tsx
  return (
    <div className="palette">
      <div className="palette-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5, flexShrink: 0 }} aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input placeholder="Search tools…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {[...groups.entries()].map(([cat, types]) => (
        <div key={cat}>
          <h4>
            {cat} <span className="count">{types.length}</span>
          </h4>
          {types.map((t) => (
            <div
              key={t.type}
              className="palette-item"
              title={t.description}
              onClick={() => !readOnly && onAdd(t.type)}
              style={readOnly ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <span className="palette-icon" style={{ color: catColor(t.category).ink }}>
                <NodeIcon type={t.type} />
              </span>
              <span>{t.label}</span>
              {t.requiresNetwork ? <span title="requires network">🌐</span> : null}
            </div>
          ))}
        </div>
      ))}
      <h4>Canvas</h4>
      <div className="palette-item" onClick={() => !readOnly && onAdd("__note")} style={readOnly ? { opacity: 0.5 } : undefined}>
        <span className="palette-icon" style={{ color: "var(--note-text)" }}>
          <NodeIcon type="__note" />
        </span>
        <span>Sticky note</span>
      </div>
    </div>
  );
```

- [ ] **Step 2: Replace the palette CSS**

In `apps/web/src/styles.css`, replace:

```css
.palette h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.5px; }
.palette-item {
  padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 4px;
  cursor: grab; font-size: 12px; background: var(--bg-panel-2);
}
.palette-item:hover { border-color: var(--accent-2); }
```

with:

```css
.palette h4 {
  margin: 12px 4px 4px; font-size: 10.5px; text-transform: uppercase; color: var(--text-dim);
  letter-spacing: 0.8px; display: flex; justify-content: space-between; align-items: baseline;
}
.palette h4 .count { opacity: 0.6; font-weight: 400; }
.palette-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px; border-radius: 7px; margin-bottom: 2px;
  cursor: pointer; font-size: 12.5px;
}
.palette-item:hover { background: var(--bg-panel-2); }
.palette-icon { display: flex; flex-shrink: 0; }
.palette-search {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg); margin-bottom: 4px;
}
.palette-search input { border: none; background: none; padding: 0; flex: 1; min-width: 0; font-size: 12.5px; }
.palette-search input:focus { outline: none; border: none; }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/canvas.tsx apps/web/src/styles.css
git commit -m "feat(web): restyle canvas toolbox with icons, category counts, and search field" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Animated data-flow edges

**Files:**
- Modify: `apps/web/src/canvas.tsx` (`toRfGraph`, lines ~118–126)
- Modify: `apps/web/src/styles.css` (append)

**Interfaces:**
- Produces: edges created by `toRfGraph` carry `animated: true` and `style: { stroke: "var(--edge)", strokeWidth: 2 }`. Task 9 later adds `label` to these edge objects.

- [ ] **Step 1: Update edge construction in `toRfGraph`**

In `apps/web/src/canvas.tsx`, change the edge mapping from `animated: false, style: { stroke: "var(--border)" }` to:

```tsx
  const edges: RFEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: true,
    style: { stroke: "var(--edge)", strokeWidth: 2 }
  }));
```

- [ ] **Step 2: Append edge CSS**

At the end of `apps/web/src/styles.css` add:

```css
/* Canvas edges: selected edge picks up the accent; label styling used from Phase 2. */
.react-flow__edge.selected .react-flow__edge-path { stroke: var(--accent) !important; }
.react-flow__edge-text { fill: var(--text-dim); font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 10.5px; }
.react-flow__edge-textbg { fill: var(--bg-panel); }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/canvas.tsx apps/web/src/styles.css
git commit -m "feat(web): animated dashed data-flow edges on the canvas" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Action bar and save-state indicator

**Files:**
- Modify: `apps/web/src/workflow.tsx` (the `CanvasTab` toolbar, lines ~359–402)
- Modify: `apps/web/src/styles.css` (append)

**Interfaces:**
- Produces: `.save-state.saved` / `.save-state.dirty` indicator spans; `button.primary.run` Run button. Task 10 later inserts a `.rows-in-play` span next to the save-state indicator. Button accessible names stay exactly `Save changes`/`Saved`, `Validate`, `▶ Run`.

- [ ] **Step 1: Update the toolbar JSX**

In `apps/web/src/workflow.tsx`, inside `CanvasTab`, make two changes to the `<div className="toolbar">` block. Change the Run button line to:

```tsx
        <button className="primary run" onClick={() => setRunOpen(true)}>▶ Run</button>
```

and replace the trailing

```tsx
        <span className="spacer" />
        {dirty && <span className="dim small">Unsaved changes</span>}
```

with:

```tsx
        <span className="spacer" />
        {!readOnly &&
          (dirty ? (
            <span className="save-state dirty">● Unsaved changes</span>
          ) : (
            <span className="save-state saved">● All changes saved</span>
          ))}
```

Also add a check icon to the Validate button (accessible name stays "Validate" — the SVG is `aria-hidden`):

```tsx
        <button
          onClick={async () => {
            try {
              const r = await api.post<any>(`/api/versions/${version.id}/validate`);
              setError(r.ok ? null : r.errors.map((e: any) => e.message).join("\n"));
              if (r.ok) alert("Workflow is valid and ready to run.");
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 5 }}>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Validate
        </button>
```

- [ ] **Step 2: Append CSS**

At the end of `apps/web/src/styles.css`:

```css
/* Canvas action bar */
.save-state { font-size: 12.5px; flex: 0 0 auto; }
.save-state.saved { color: var(--green); }
.save-state.dirty { color: var(--amber); }
button.primary.run { background: var(--tint-green-bg); border-color: var(--green); color: var(--green); }
button.primary.run:hover:not(:disabled) { background: var(--green); color: #fff; }
.rows-in-play { font-size: 12.5px; color: var(--text-dim); flex: 0 0 auto; }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflow.tsx apps/web/src/styles.css
git commit -m "feat(web): canvas action bar polish with save-state indicator and green run button" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Sticky-note restyle

**Files:**
- Modify: `apps/web/src/canvas.tsx` (the `TfNote` component, lines ~72–97)
- Modify: `apps/web/src/styles.css` (the `.tf-note` rule, lines ~230–235)

**Interfaces:**
- Consumes: `NodeIcon` (type `"__note"`).
- Produces: notes render a `.tf-note-head` header row containing the mono text `NOTE`. Text editing, resize, and font-size toolbar behavior unchanged.

- [ ] **Step 1: Add the header row to `TfNote`**

In `apps/web/src/canvas.tsx`, inside `TfNote`'s returned JSX, insert directly after the `{showToolbar && (...)}` block (i.e., before the read-only/textarea branch):

```tsx
      <div className="tf-note-head">
        <NodeIcon type="__note" size={13} />
        <span className="mono">NOTE</span>
      </div>
```

- [ ] **Step 2: Update note CSS**

Replace the `.tf-note` rule in `apps/web/src/styles.css`:

```css
.tf-note {
  position: relative;
  background: var(--note-bg); border: 1px solid var(--note-border); border-radius: 8px; padding: 10px;
  font-size: 12px; color: var(--note-text); white-space: pre-wrap;
  width: 100%; height: 100%; box-sizing: border-box; display: flex;
}
```

with:

```css
.tf-note {
  position: relative;
  background: var(--note-bg); border: 1.5px dashed var(--note-border); border-radius: 8px; padding: 10px 12px;
  font-size: 12px; color: var(--note-text); white-space: pre-wrap;
  width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px;
}
.tf-note-head { display: flex; align-items: center; gap: 6px; opacity: 0.75; flex: 0 0 auto; }
.tf-note-head .mono { font-size: 10px; letter-spacing: 0.8px; }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/canvas.tsx apps/web/src/styles.css
git commit -m "feat(web): restyle canvas sticky notes as dashed NOTE annotations" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Phase 1 E2E coverage

**Files:**
- Create: `e2e/zz-canvas-design.spec.ts`

**Interfaces:**
- Consumes: DOM contracts from Tasks 2, 3, 5, 6 (`.node-chip`, `.node-cat`, `.palette-search input`, `.palette-icon`, `.save-state`, `.tf-note-head`).

- [ ] **Step 1: Write the spec**

Create `e2e/zz-canvas-design.spec.ts`:

```ts
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

  // Add a node from the palette → redesigned card appears.
  await page.locator(".palette-item", { hasText: "Import File" }).click();
  const node = page.locator(".tf-node", { hasText: "Import File" });
  await expect(node).toBeVisible();
  await expect(node.locator(".node-chip svg")).toBeVisible();
  await expect(node.locator(".node-cat")).toContainText("IMPORT");

  // Save-state indicator flips dirty → saved.
  await expect(page.locator(".save-state.dirty")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".save-state.saved")).toBeVisible();

  // Sticky note gets the NOTE header.
  await page.locator(".palette-item", { hasText: "Sticky note" }).click();
  await expect(page.locator(".tf-note .tf-note-head", { hasText: "NOTE" })).toBeVisible();

  // Both themes render the redesigned node (toggle lives in the sidebar).
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator(".theme-toggle").click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await expect(node.locator(".node-chip svg")).toBeVisible();
});
```

(The theme toggle selector is confirmed: `apps/web/src/App.tsx` line ~25 renders `<button className="sidebar-toggle theme-toggle">` in the sidebar.)

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run build && npm run test:e2e`
Expected: all specs pass, including the new one.

- [ ] **Step 3: Commit**

```bash
git add e2e/zz-canvas-design.spec.ts
git commit -m "test(e2e): cover redesigned canvas visuals in both themes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Phase 2 — Live data flow (row counts on nodes, edges, action bar)

**Background for all Phase 2 tasks:** during a run, the API's SSE `node` events (see `apps/api/src/executions.ts` lines ~142–152 — do not modify) already include `outputSummary`: a map from output-handle name to `{ rows: number, columns: number }`, possibly mixed with extra node-specific summary keys of other shapes. The replay endpoint (`apps/api/src/server.ts` line ~430) sends the same shape for finished runs. Phase 2 is purely client-side consumption of this field.

### Task 8: Capture run summaries and show a stats line on node cards

**Files:**
- Modify: `apps/web/src/components.tsx` (append one export)
- Modify: `apps/web/src/workflow.tsx` (`CanvasTab` state + SSE handler + status-merge effect, lines ~120–351)
- Modify: `apps/web/src/canvas.tsx` (`TfNode`)

**Interfaces:**
- Produces: `fmtInt(n: number): string` exported from `./components` (US-grouped integer, e.g. `9,340`); `CanvasTab` state `nodeSummaries: Record<string, Record<string, { rows: number; columns: number }>>` (nodeId → handle → counts), also consumed by Tasks 9–11; node `data.summary` carries that node's handle map into `TfNode`, which renders `.node-stats`.

- [ ] **Step 1: Add the formatter to `apps/web/src/components.tsx`**

Append:

```tsx
/** 1234567 → "1,234,567" (row/column counts on the canvas). */
export const fmtInt = (n: number): string => n.toLocaleString("en-US");
```

- [ ] **Step 2: Track summaries in `CanvasTab`**

In `apps/web/src/workflow.tsx`, below the `nodeOutputs` state declaration, add:

```tsx
  const [nodeSummaries, setNodeSummaries] = useState<Record<string, Record<string, { rows: number; columns: number }>>>({});
```

In `run(...)`, next to `setNodeStatuses({});` add:

```tsx
    setNodeSummaries({});
```

In the SSE handler, inside `if (event.type === "node") { ... }`, after the `outputDatasetVersionIds` block, add:

```tsx
          if (event.data.outputSummary) {
            // outputSummary mixes handle entries ({rows, columns}) with node-specific
            // summary keys of other shapes — keep only the handle entries.
            const clean: Record<string, { rows: number; columns: number }> = {};
            for (const [k, v] of Object.entries<any>(event.data.outputSummary)) {
              if (v && typeof v === "object" && typeof v.rows === "number" && typeof v.columns === "number") {
                clean[k] = { rows: v.rows, columns: v.columns };
              }
            }
            if (Object.keys(clean).length) setNodeSummaries((s) => ({ ...s, [event.data.nodeId]: clean }));
          }
```

Replace the status-merge effect (currently keyed on `[nodeStatuses]`) with:

```tsx
  // Apply node execution statuses + row-count summaries onto canvas nodes.
  useEffect(() => {
    setRfNodes((nodes) =>
      nodes.map((n) =>
        n.type === "tfNode" ? { ...n, data: { ...n.data, status: nodeStatuses[n.id], summary: nodeSummaries[n.id] } } : n
      )
    );
  }, [nodeStatuses, nodeSummaries]);
```

- [ ] **Step 3: Render the stats line in `TfNode`**

In `apps/web/src/canvas.tsx`, add `fmtInt` to the imports:

```tsx
import { fmtInt } from "./components";
```

(If this creates a circular import — `components.tsx` currently does not import from `canvas.tsx`, so it should not — fall back to declaring `const fmtInt = (n: number) => n.toLocaleString("en-US");` locally in `canvas.tsx` instead.)

Inside `TfNode`, before the `return`, add:

```tsx
  const summary: Record<string, { rows: number; columns: number }> | undefined = data.summary;
  const entries = summary ? Object.entries(summary) : [];
  const statsLine =
    entries.length === 1
      ? `${fmtInt(entries[0][1].rows)} rows · ${entries[0][1].columns} cols`
      : entries.length > 1
        ? entries.map(([h, v]) => `${h} ${fmtInt(v.rows)}`).join(" · ")
        : null;
```

and inside `.node-body`, directly after the `.node-title` div, add:

```tsx
          {statsLine && <div className="node-stats">{statsLine}</div>}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components.tsx apps/web/src/workflow.tsx apps/web/src/canvas.tsx
git commit -m "feat(web): show per-node row and column counts on canvas cards after a run" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Row-count labels on edges

**Files:**
- Modify: `apps/web/src/workflow.tsx` (`CanvasTab`)

**Interfaces:**
- Consumes: `nodeSummaries` (Task 8), `fmtInt` (Task 8), `getNodeType` (already imported in `workflow.tsx`).
- Produces: edges passed to `FlowCanvas` carry `label: "N rows"` when the source node has run. Labels are render-only — `fromRfGraph` ignores them, so nothing is persisted.

- [ ] **Step 1: Derive labeled edges**

In `apps/web/src/workflow.tsx`, add `fmtInt` to the import from `./components` (the line already imports `Badge, ErrorBox, Modal, DataPreview, ParameterInputs, fmtDate, duration`).

Inside `CanvasTab`, after the `selectedOutputs` line, add:

```tsx
  // Edge labels: rows produced by the source port in the last run (render-only; not persisted).
  const labeledEdges = useMemo(
    () =>
      rfEdges.map((e) => {
        const srcType = (rfNodes.find((n) => n.id === e.source)?.data as any)?.nodeType as string | undefined;
        const handle = e.sourceHandle ?? getNodeType(srcType ?? "")?.outputs[0]?.name ?? "output";
        const s = nodeSummaries[e.source]?.[handle];
        return s ? { ...e, label: `${fmtInt(s.rows)} rows` } : e;
      }),
    [rfEdges, rfNodes, nodeSummaries]
  );
```

- [ ] **Step 2: Feed them to the canvas**

In the same component's JSX, change `rfEdges={rfEdges}` on `<FlowCanvas>` to:

```tsx
          rfEdges={labeledEdges}
```

(`FlowCanvas`'s `setRfEdges` still updates the underlying `rfEdges` state by id, so edits/deletes keep working; labels are re-derived each render.)

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflow.tsx
git commit -m "feat(web): row-count labels on canvas edges after a run" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: "Rows in play" action-bar summary

**Files:**
- Modify: `apps/web/src/workflow.tsx` (`CanvasTab`)

**Interfaces:**
- Consumes: `nodeSummaries`, `fmtInt`, `getNodeType`.
- Produces: a `.rows-in-play` span (CSS from Task 5) in the toolbar reading `<total> rows in play across <steps> steps`, where total = sum of rows produced by **source nodes** (nodes whose type definition has no inputs — matches the mockup's 9,340 + 8,900 = 18,240) and steps = count of workflow nodes on the canvas.

- [ ] **Step 1: Compute the totals**

In `CanvasTab`, after the `labeledEdges` memo, add:

```tsx
  // "Rows in play" = rows entering the workflow via source nodes in the last run.
  const rowsInPlay = useMemo(() => {
    let total = 0;
    let found = false;
    for (const n of rfNodes) {
      if (n.type !== "tfNode") continue;
      const def = getNodeType((n.data as any).nodeType);
      if (!def || def.inputs.length > 0) continue;
      for (const v of Object.values(nodeSummaries[n.id] ?? {})) {
        total += v.rows;
        found = true;
      }
    }
    return found ? total : null;
  }, [rfNodes, nodeSummaries]);
  const stepCount = rfNodes.filter((n) => n.type === "tfNode").length;
```

- [ ] **Step 2: Render it in the toolbar**

In the toolbar JSX, directly after `<span className="spacer" />`, add:

```tsx
        {rowsInPlay !== null && (
          <span className="rows-in-play">
            {fmtInt(rowsInPlay)} rows in play across {stepCount} {stepCount === 1 ? "step" : "steps"}
          </span>
        )}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflow.tsx
git commit -m "feat(web): rows-in-play summary in the canvas action bar" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Join segmented control and per-output row chips in the inspector

**Files:**
- Modify: `apps/web/src/nodeconfig.tsx` (the `case "join":` block, lines ~356–381)
- Modify: `apps/web/src/workflow.tsx` (`CanvasTab` "Last run outputs" block, lines ~447–470)
- Modify: `apps/web/src/styles.css` (append)

**Interfaces:**
- Consumes: `nodeSummaries` (Task 8), `fmtInt`.
- Produces: `.seg`/`.seg-btn` segmented control (config forms sit inside a `<fieldset disabled={readOnly}>` — see `nodeconfig.tsx` line ~725 — so the buttons are automatically disabled in read-only mode); inspector output rows keep buttons named exactly `Preview: <handle>` (E2E contract) and add a `.chip` with the handle's row count.

- [ ] **Step 1: Replace the join-type select with a segmented control**

In `apps/web/src/nodeconfig.tsx`, replace:

```tsx
          <Field label="Join type">
            <select value={cfg.joinType ?? "inner"} onChange={(e) => set({ joinType: e.target.value })}>
              <option value="inner">Inner — only matches</option>
              <option value="left">Left — keep all left rows</option>
              <option value="full">Full outer — keep everything</option>
            </select>
          </Field>
```

with:

```tsx
          <Field label="Join type" hint="inner: only matches · left: keep all left rows · full: keep everything">
            <div className="seg">
              {([["inner", "Inner"], ["left", "Left"], ["full", "Full"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`seg-btn ${(cfg.joinType ?? "inner") === value ? "active" : ""}`}
                  onClick={() => set({ joinType: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
```

Check the `Field` component in the same file: if its props don't include `hint`, look at how other `Field` usages pass hints (e.g. the `append` case at line ~384 uses `hint`), so it does.

- [ ] **Step 2: Add row-count chips to "Last run outputs"**

In `apps/web/src/workflow.tsx`, replace the body of the `Object.entries(selectedOutputs).map(...)` inside the "Last run outputs" block with:

```tsx
                  {Object.entries(selectedOutputs).map(([handle, dsvId]) => (
                    <span key={handle} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8, marginBottom: 6 }}>
                      <button
                        className="small"
                        onClick={() =>
                          setPreviewDsv({
                            id: dsvId,
                            label: `${(selectedNode.data as any).label} → ${handle}`,
                            chartType:
                              (selectedNode.data as any).nodeType === "chart"
                                ? ((selectedNode.data as any).config?.chartType ?? "bar")
                                : undefined
                          })
                        }
                      >
                        Preview: {handle}
                      </button>
                      {selectedId && nodeSummaries[selectedId]?.[handle] && (
                        <span className="chip mono">{fmtInt(nodeSummaries[selectedId][handle].rows)} rows</span>
                      )}
                    </span>
                  ))}
```

(The button's accessible name remains `Preview: <handle>` — the chip is a sibling, not a child.)

- [ ] **Step 3: Append segmented-control CSS**

At the end of `apps/web/src/styles.css`:

```css
/* Segmented control (join type, per design config panel) */
.seg { display: flex; gap: 6px; }
.seg-btn {
  flex: 1; padding: 7px 0; text-align: center; border-radius: 6px;
  border: 1px solid var(--border); background: none; color: var(--text-dim); font-size: 12px; cursor: pointer;
}
.seg-btn.active { background: var(--accent-2); border-color: var(--accent-2); color: #fff; font-weight: 600; }
.seg-btn:disabled { opacity: 0.55; cursor: not-allowed; }
```

- [ ] **Step 4: Verify the build**

Run: `npm run build -w @traceforge/web`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/nodeconfig.tsx apps/web/src/workflow.tsx apps/web/src/styles.css
git commit -m "feat(web): join-type segmented control and output row-count chips in the inspector" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Phase 2 E2E coverage

**Files:**
- Create: `e2e/zz-canvas-live.spec.ts`

**Interfaces:**
- Consumes: `.node-stats` (Task 8), edge labels (Task 9), `.rows-in-play` (Task 10), `.chip` row counts (Task 11). Builds its workflow through the API exactly like `e2e/zz-chart.spec.ts` does.

- [ ] **Step 1: Write the spec**

Create `e2e/zz-canvas-live.spec.ts`:

```ts
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
```

(The `sample` node's config shape is confirmed against `sampleConfig` in `packages/domain/src/nodes.ts` lines 88–91: `{ mode: "first" | "random", rows: positive int }`.)

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run build && npm run test:e2e`
Expected: all specs pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/zz-canvas-live.spec.ts
git commit -m "test(e2e): cover live row counts on nodes, edges, and action bar" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Final verification and docs sync

**Files:**
- Modify: possibly `features/canvas-builder.md` (check first)

- [ ] **Step 1: Full workspace verification**

Run: `npm run build && npm run test && npm run test:e2e`
Expected: all three exit 0 (unit tests cover `packages/*` and must be untouched by this plan).

- [ ] **Step 2: Documentation check**

Read `features/canvas-builder.md` (and `gates.md` if it references canvas visuals). If either describes node/palette/toolbar visuals that this plan changed (e.g., "nodes show category · label text"), update those sentences to match the new UI: category icon chips, colored category tags, animated edges, row-count labels after runs, save-state indicator, rows-in-play summary, segmented join control. If they only describe behavior (unchanged), no edit is needed.

- [ ] **Step 3: Commit (only if docs changed)**

```bash
git add features/canvas-builder.md
git commit -m "docs: sync canvas-builder feature doc with redesigned canvas UI" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Phase 3 — Deferred (needs its own plan; do NOT implement from this document)

Explicitly out of scope here; each item is a distinct product decision to brainstorm and plan separately:

1. **Option 1C "structured stage lanes"** — an alternative canvas view that lays nodes out in stage columns (Import → Merge → Transform → Output) instead of free placement. Different interaction paradigm; would likely be a view-mode toggle on top of the same graph model.
2. **Output-port "+" quick-add** — clicking a node's output port opens a picker that appends a pre-connected downstream node.
3. **Versions dropdown** — folding the Versions tab into the header's `v1 — draft ▾` dropdown as the mockup shows (requires rehoming promote/review actions).
