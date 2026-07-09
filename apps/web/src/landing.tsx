import type { MouseEvent } from "react";

/** Scrolls to the feature cards section in-place, without changing location.hash
 * (which would otherwise trip the hash router in App.tsx and navigate away
 * from the landing page). */
function scrollToFeatures(e: MouseEvent) {
  e.preventDefault();
  document.getElementById("features-section")?.scrollIntoView({ behavior: "smooth" });
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
          <a href="#features-section" className="btn" onClick={scrollToFeatures}>See how it works</a>
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
          <div className="landing-feature-icon" aria-hidden="true">⚿</div>
          <h3>A canvas, not code</h3>
          <p>Drag out import, merge, and transform steps and connect them by hand. If you can describe the test in plain language, you can build it here.</p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon" aria-hidden="true">✓</div>
          <h3>Verify once, trust always</h3>
          <p>Lock a workflow once its logic checks out. Verified versions can't drift, so everyone downstream knows exactly what they're relying on.</p>
        </div>
        <div className="landing-feature-card">
          <div className="landing-feature-icon" aria-hidden="true">↻</div>
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
