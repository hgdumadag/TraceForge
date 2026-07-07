import { useEffect, useState } from "react";
import { CatalogPage, TemplatesPage, DatasetsPage, ToolkitPage, SettingsPage } from "./pages";
import { WorkflowPage } from "./workflow";

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

  const nav = [
    { hash: "#/", label: "Workflows" },
    { hash: "#/templates", label: "Templates" },
    { hash: "#/datasets", label: "Datasets" },
    { hash: "#/toolkit", label: "Toolkit" },
    { hash: "#/settings", label: "Settings" }
  ];

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="logo">Trace<span>Forge</span></div>
        {nav.map((n) => (
          <button
            key={n.hash}
            className={`navlink ${hash === n.hash || (n.hash === "#/" && workflowMatch) ? "active" : ""}`}
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
        ) : (
          <CatalogPage navigate={navigate} />
        )}
      </main>
    </div>
  );
}
