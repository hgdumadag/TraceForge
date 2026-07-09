import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ReactFlow, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toRfGraph, nodeTypes } from "./canvas";
import { useTheme } from "./theme";
import { ThemeToggle } from "./theme-toggle";
import { LANDING_SCENES } from "./landing-templates";

/** Scrolls to the feature cards section in-place, without changing location.hash
 * (which would otherwise trip the hash router in App.tsx and navigate away
 * from the landing page). */
function scrollToFeatures(e: MouseEvent) {
  e.preventDefault();
  document.getElementById("features-section")?.scrollIntoView({ behavior: "smooth" });
}

const ROTATE_MS = 5500;
const NO_STATUSES = {};

/** Auto-rotating preview of real built-in audit templates, rendered with the same
 * read-only-styled node/edge components as the canvas builder (canvas.tsx) — so the
 * dashed edges animate exactly like the real thing. */
function LandingIllustration() {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (paused || reducedMotion.current) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % LANDING_SCENES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused]);

  const scene = LANDING_SCENES[index];
  const { nodes, edges } = useMemo(() => toRfGraph(scene.graph, NO_STATUSES), [scene]);

  return (
    <div
      className="landing-illustration"
      aria-hidden="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="landing-illustration-chrome">
        <span className="landing-illustration-dot" /><span className="landing-illustration-dot" /><span className="landing-illustration-dot" />
        <span className="landing-illustration-chrome-title mono">{scene.name}</span>
      </div>
      <div className="landing-illustration-canvas">
        <ReactFlow
          key={scene.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          colorMode={theme}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          style={{ pointerEvents: "none" }}
        >
          <Background gap={18} color={theme === "light" ? "#c8d2dd" : "#232b34"} />
        </ReactFlow>
      </div>
      <div className="landing-illustration-dots">
        {LANDING_SCENES.map((s, i) => (
          <button
            key={s.id}
            className={i === index ? "active" : ""}
            aria-label={s.name}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}

/** Marketing-style entry screen shown at "#/", before the app shell. */
export function LandingPage({ navigate }: { navigate: (h: string) => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="logo">Trace<span>Forge</span></div>
        <nav className="landing-nav-links">
          <a href="#features-section" onClick={scrollToFeatures}>Features</a>
          <a href="#features-section" onClick={scrollToFeatures}>How it works</a>
          <button className="link-btn" onClick={() => navigate("#/guide")}>Guide</button>
        </nav>
        <div className="landing-nav-actions">
          <ThemeToggle className="sidebar-toggle theme-toggle landing-theme-toggle" />
          <button className="primary" onClick={() => navigate("#/workflows")}>Open Workflows</button>
        </div>
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
          <a href="#features-section" className="btn" onClick={scrollToFeatures}>See how it works</a>
        </div>

        <LandingIllustration />
      </section>

      <section className="landing-features" id="features-section">
        <div className="landing-feature-card">
          <div className="landing-feature-icon cat-merge" aria-hidden="true">⚿</div>
          <h3>A canvas, not code</h3>
          <p>Drag out import, merge, and transform steps and connect them by hand. If you can describe the test in plain language, you can build it here.</p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon cat-transform" aria-hidden="true">✓</div>
          <h3>Verify once, trust always</h3>
          <p>Lock a workflow once its logic checks out. Verified versions can't drift, so everyone downstream knows exactly what they're relying on.</p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon cat-governance" aria-hidden="true">↻</div>
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
