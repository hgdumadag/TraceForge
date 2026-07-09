import { useEffect, useState } from "react";
import { CatalogPage, TemplatesPage, DatasetsPage, ToolkitPage, SettingsPage } from "./pages";
import { WorkflowPage } from "./workflow";
import { GuidePage } from "./guide";
import { LandingPage } from "./landing";
import { ThemeToggle } from "./theme-toggle";

function useHashRoute(): [string, (h: string) => void] {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = (h: string) => {
    location.hash = h;
  };
  return [hash, navigate];
}

export default function App() {
  const [hash, navigate] = useHashRoute();
  const workflowMatch = hash.match(/^#\/workflows\/([^/]+)/);
  const workflowId = workflowMatch?.[1];

  // Auto-collapse the sidebar when entering the workflow editor to maximize
  // canvas space. The user can re-expand it manually; we only collapse again
  // when they enter a (different) workflow editor view.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    if (workflowId) setSidebarCollapsed(true);
  }, [workflowId]);

  if (hash === "#/") {
    return <LandingPage navigate={navigate} />;
  }

  const nav = [
    { hash: "#/workflows", label: "Workflows" },
    { hash: "#/templates", label: "Templates" },
    { hash: "#/datasets", label: "Datasets" },
    { hash: "#/toolkit", label: "Toolkit" },
    { hash: "#/settings", label: "Settings" },
    { hash: "#/guide", label: "Guide" }
  ];

  return (
    <div className="app">
      <nav className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-head">
          <button className="logo logo-link" onClick={() => navigate("#/")}>Trace<span>Forge</span></button>
          <div style={{ display: "flex", flexShrink: 0 }}>
            <ThemeToggle />
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>
        </div>
        {nav.map((n) => (
          <button
            key={n.hash}
            className={`navlink ${hash === n.hash || (n.hash === "#/workflows" && workflowMatch) ? "active" : ""}`}
            onClick={() => navigate(n.hash)}
          >
            {n.label}
          </button>
        ))}
        <div className="foot">
          Local-first audit analytics.<br />Data stays on this machine.
        </div>
      </nav>
      <main className="main">
        {workflowMatch ? (
          <WorkflowPage workflowId={workflowMatch[1]} navigate={navigate} />
        ) : hash === "#/templates" ? (
          <TemplatesPage navigate={navigate} />
        ) : hash === "#/datasets" ? (
          <DatasetsPage />
        ) : hash === "#/toolkit" ? (
          <ToolkitPage navigate={navigate} />
        ) : hash === "#/settings" ? (
          <SettingsPage />
        ) : hash === "#/guide" ? (
          <GuidePage />
        ) : (
          <CatalogPage navigate={navigate} />
        )}
      </main>
    </div>
  );
}
