/** Catalog, template library, datasets, toolkit, and settings pages. */
import { useEffect, useMemo, useState } from "react";
import { api, type WorkflowRow } from "./api";
import { Badge, ErrorBox, Modal, DataPreview, fmtDate } from "./components";

const ALL_COLUMNS = ["Service", "Name", "Description", "Verification", "Active Version", "Published By", "Published", "Automations", "Updated"] as const;

export function CatalogPage({ navigate }: { navigate: (h: string) => void }) {
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("tf_catalog_columns") || "null") ?? [...ALL_COLUMNS];
    } catch {
      return [...ALL_COLUMNS];
    }
  });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "Updated", dir: -1 });

  const load = () =>
    api.get<WorkflowRow[]>(`/api/workflows?includeArchived=${includeArchived}&search=${encodeURIComponent(search)}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, [search, includeArchived]);

  useEffect(() => localStorage.setItem("tf_catalog_columns", JSON.stringify(visibleCols)), [visibleCols]);

  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter === "verified") out = out.filter((r) => r.verificationStatus === "verified");
    if (statusFilter === "unverified") out = out.filter((r) => r.verificationStatus !== "verified");
    if (statusFilter === "archived") out = out.filter((r) => r.status === "archived");
    const key = sort.key;
    return [...out].sort((a, b) => {
      const va = key === "Name" ? a.name : key === "Service" ? a.category : key === "Verification" ? a.verificationStatus : key === "Published" ? a.publishedAt ?? "" : a.updatedAt;
      const vb = key === "Name" ? b.name : key === "Service" ? b.category : key === "Verification" ? b.verificationStatus : key === "Published" ? b.publishedAt ?? "" : b.updatedAt;
      return va < vb ? -sort.dir : va > vb ? sort.dir : 0;
    });
  }, [rows, statusFilter, sort]);

  const col = (name: string) => visibleCols.includes(name);
  const sortBy = (key: string) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));

  return (
    <div className="page">
      <h1>Workflow Catalog</h1>
      <p className="sub">Reusable audit analytics workflows. Verified versions are immutable; active versions power the toolkit.</p>
      <div className="toolbar">
        <button className="primary" onClick={() => setCreateOpen(true)}>+ Workflow</button>
        <button onClick={() => navigate("#/templates")}>Clone Template</button>
        <input placeholder="Search name, description, service…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="verified">Verified only</option>
          <option value="unverified">Unverified only</option>
          <option value="archived">Archived only</option>
        </select>
        <label className="small dim" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> show archived
        </label>
        <span className="spacer" />
        <button onClick={() => setColumnsOpen(true)}>Manage columns</button>
      </div>
      <ErrorBox error={error} />
      <div className="grid-wrap" style={{ maxHeight: "70vh" }}>
        <table className="grid">
          <thead>
            <tr>
              {col("Service") && <th onClick={() => sortBy("Service")} style={{ cursor: "pointer" }}>Service</th>}
              {col("Name") && <th onClick={() => sortBy("Name")} style={{ cursor: "pointer" }}>Name</th>}
              {col("Description") && <th>Description</th>}
              {col("Verification") && <th onClick={() => sortBy("Verification")} style={{ cursor: "pointer" }}>Verification</th>}
              {col("Active Version") && <th>Active Version</th>}
              {col("Published By") && <th>Version Published By</th>}
              {col("Published") && <th onClick={() => sortBy("Published")} style={{ cursor: "pointer" }}>Version Published</th>}
              {col("Automations") && <th>Automations</th>}
              {col("Updated") && <th onClick={() => sortBy("Updated")} style={{ cursor: "pointer" }}>Updated</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`#/workflows/${r.id}`)}>
                {col("Service") && <td>{r.category || <span className="dim">—</span>}</td>}
                {col("Name") && <td style={{ fontWeight: 600 }}>{r.name} {r.status === "archived" && <Badge status="archived" />}</td>}
                {col("Description") && <td className="dim" style={{ maxWidth: 320 }}>{r.description.slice(0, 120)}</td>}
                {col("Verification") && <td><Badge status={r.verificationStatus} /></td>}
                {col("Active Version") && <td>{r.activeVersionNumber ? `v${r.activeVersionNumber}` : <span className="dim">—</span>}</td>}
                {col("Published By") && <td>{r.publishedBy ?? <span className="dim">—</span>}</td>}
                {col("Published") && <td>{fmtDate(r.publishedAt)}</td>}
                {col("Automations") && <td>{r.automationsConnected}</td>}
                {col("Updated") && <td>{fmtDate(r.updatedAt)}</td>}
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="small" onClick={() => api.post(`/api/workflows`, { duplicateOfWorkflowId: r.id }).then(load).catch((e2) => setError(e2.message))}>Duplicate</button>{" "}
                  {r.status !== "archived" && (
                    <button className="small" onClick={() => confirm(`Archive "${r.name}"? Run history and evidence are preserved.`) && api.post(`/api/workflows/${r.id}/archive`).then(load).catch((e2) => setError(e2.message))}>
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  {rows.length === 0 ? <>No workflows yet. Create one with <b>+ Workflow</b> or clone an audit template.</> : <>No workflows match your filters. <button className="small" onClick={() => { setSearch(""); setStatusFilter(""); }}>Clear filters</button></>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {createOpen && <CreateWorkflowModal onClose={() => setCreateOpen(false)} navigate={navigate} />}
      {columnsOpen && (
        <Modal title="Manage columns" onClose={() => setColumnsOpen(false)}>
          {ALL_COLUMNS.map((c) => (
            <label key={c} style={{ display: "block", padding: "4px 0" }}>
              <input
                type="checkbox"
                checked={visibleCols.includes(c)}
                onChange={(e) => setVisibleCols(e.target.checked ? [...visibleCols, c] : visibleCols.filter((x) => x !== c))}
              />{" "}
              {c}
            </label>
          ))}
        </Modal>
      )}
    </div>
  );
}

function CreateWorkflowModal({ onClose, navigate }: { onClose: () => void; navigate: (h: string) => void }) {
  const [mode, setMode] = useState<"blank" | "ai">("blank");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [objective, setObjective] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<any[]>([]);

  useEffect(() => { api.get<any[]>("/api/llm/providers").then(setProviders).catch(() => {}); }, []);
  const defaultProvider = providers.find((p) => p.isDefault);

  const createBlank = () =>
    api.post<any>("/api/workflows", { name, description, category })
      .then((r) => { onClose(); navigate(`#/workflows/${r.workflow.id}`); })
      .catch((e) => setError(e.message));

  const generate = async () => {
    setBusy(true);
    setError(null);
    setAiResult(null);
    try {
      setAiResult(await api.post<any>("/api/llm/generate-workflow", { objective }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const acceptAi = () =>
    api.post<any>("/api/workflows", { name: aiResult.draft.name, description: aiResult.draft.description, category: aiResult.draft.category })
      .then(async (r) => {
        await api.put(`/api/versions/${r.version.id}`, { graph: aiResult.draft.graph, parameters: aiResult.draft.parameters });
        onClose();
        navigate(`#/workflows/${r.workflow.id}`);
      })
      .catch((e) => setError(e.message));

  return (
    <Modal title="Create workflow" onClose={onClose}>
      <div className="tabs">
        <button className={`tab ${mode === "blank" ? "active" : ""}`} onClick={() => setMode("blank")}>Blank</button>
        <button className={`tab ${mode === "ai" ? "active" : ""}`} onClick={() => setMode("ai")}>AI-assisted draft</button>
      </div>
      <ErrorBox error={error} />
      {mode === "blank" && (
        <>
          <label className="field"><span>Name *</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="field"><span>Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="field"><span>Service / category</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Payroll, T&E, IT Controls" /></label>
          <button className="primary" disabled={!name.trim()} onClick={createBlank}>Create workflow</button>
        </>
      )}
      {mode === "ai" && (
        <>
          <div className={defaultProvider?.kind === "cloud" ? "warn-box" : "info-box"}>
            Provider: <b>{defaultProvider?.displayName ?? "Ollama (local)"}</b>
            {defaultProvider?.kind === "cloud"
              ? " — cloud provider: your prompt leaves this machine. No audit data is sent, only your description."
              : " — runs locally; nothing leaves this machine."}
          </div>
          <label className="field"><span>Describe the audit test objective</span>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. Test vendor invoices for duplicate payments by vendor and invoice number, with a materiality threshold parameter" rows={3} />
          </label>
          <button className="primary" disabled={busy || !objective.trim()} onClick={generate}>{busy ? "Generating…" : "Generate draft"}</button>
          {aiResult && (
            <div className="card" style={{ marginTop: 10 }}>
              <h3>{aiResult.draft.name}</h3>
              <p className="small dim">{aiResult.draft.description}</p>
              <p className="small">{aiResult.draft.graph.nodes.length} nodes, {aiResult.draft.graph.edges.length} edges, {aiResult.draft.parameters.length} parameters — via {aiResult.providerId}</p>
              {!aiResult.valid && <div className="warn-box">The draft has validation issues (you can fix them on the canvas): {aiResult.validationErrors.slice(0, 3).join("; ")}</div>}
              <div className="row">
                <button className="primary" onClick={acceptAi}>Accept and open canvas</button>
                <button onClick={() => setAiResult(null)} style={{ flex: "0 0 auto" }}>Discard</button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function TemplatesPage({ navigate }: { navigate: (h: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [cloneName, setCloneName] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => { api.get<any>("/api/templates").then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <div className="page dim">Loading…</div>;

  const categories: string[] = [...new Set<string>(data.builtIn.map((t: any) => t.category))];
  const templates = data.builtIn.filter(
    (t: any) =>
      (!search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase())) &&
      (!category || t.category === category)
  );

  return (
    <div className="page">
      <h1>Template Library</h1>
      <p className="sub">Audit-ready starting points. Cloning creates an editable draft workflow — templates themselves never change.</p>
      <div className="toolbar">
        <input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="cards">
        {templates.map((t: any) => (
          <div className="card" key={t.id}>
            <h3>{t.name}</h3>
            <div style={{ marginBottom: 6 }}>
              <span className="chip">{t.category}</span>
              {t.tags.map((tag: string) => <span className="chip" key={tag}>{tag}</span>)}
              {t.containsCustomCode && <span className="chip">contains code</span>}
              {t.requiresCredential && <span className="chip">needs credentials</span>}
            </div>
            <p className="small dim">{t.description}</p>
            <p className="small"><b>{t.nodeCount}</b> nodes · <b>{t.parameters.length}</b> parameters · inputs: {t.requiredInputs.map((i: any) => i.name).join(", ") || "none"}</p>
            <button className="primary small" onClick={async () => { setPreview(await api.get(`/api/templates/${t.id}`)); setCloneName(t.name); }}>Preview & clone</button>
          </div>
        ))}
        {templates.length === 0 && <div className="empty">No templates match your filters.</div>}
      </div>

      {data.publishedTools.length > 0 && (
        <>
          <h2>Published toolkit</h2>
          <p className="sub">Verified workflows your team published for reuse.</p>
          <div className="cards">
            {data.publishedTools.map((tool: any) => (
              <div className="card" key={tool.id}>
                <h3>{tool.name} <Badge status="published" /></h3>
                <p className="small dim">{tool.description}</p>
                <p className="small">Published by {tool.publishedBy} on {fmtDate(tool.publishedAt)}</p>
                <button className="small primary" onClick={() => api.post<any>(`/api/toolkit/${tool.id}/clone`, {}).then((r) => navigate(`#/workflows/${r.workflow.id}`)).catch((e) => setError(e.message))}>Clone to draft</button>
              </div>
            ))}
          </div>
        </>
      )}

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)} wide>
          <p>{preview.description}</p>
          <dl className="kv">
            <dt>Category</dt><dd>{preview.category}</dd>
            <dt>Risk addressed</dt><dd>{preview.riskStatement || "—"}</dd>
            <dt>Required inputs</dt>
            <dd>{preview.requiredInputs.map((i: any) => <div key={i.name}><b>{i.name}</b> <span className="dim">{i.description}</span></div>)}</dd>
            <dt>Parameters</dt>
            <dd>{preview.parameters.map((p: any) => <div key={p.key}><code>{p.key}</code> ({p.type}{p.defaultValue !== undefined && p.defaultValue !== null ? ` = ${p.defaultValue}` : ""}) — {p.label}</div>)}</dd>
            <dt>Expected outputs</dt><dd>{preview.expectedOutputs.join(", ") || "—"}</dd>
            <dt>Custom code</dt><dd>{preview.containsCustomCode ? "Yes — Python nodes present" : "No"}</dd>
            <dt>Credentials</dt><dd>{preview.requiresCredential ? "Required" : "Not required"}</dd>
            <dt>Sample data</dt><dd>{preview.sampleDatasetIds.join(", ") || "—"}</dd>
          </dl>
          <label className="field" style={{ marginTop: 10 }}><span>New workflow name</span>
            <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
          </label>
          <button
            className="primary"
            disabled={!cloneName.trim()}
            onClick={() =>
              api.post<any>("/api/workflows", { templateId: preview.id, name: cloneName })
                .then((r) => navigate(`#/workflows/${r.workflow.id}`))
                .catch((e) => setError(e.message))
            }
          >
            Clone template
          </button>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sheetPrompt, setSheetPrompt] = useState<{ file: File; sheets: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<any[]>("/api/datasets").then(setDatasets).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const upload = async (file: File, sheet?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.upload("/api/datasets/import", file, sheet ? { sheet } : {});
      if (result.needsSheetSelection) {
        setSheetPrompt({ file, sheets: result.sheets });
      } else {
        setSheetPrompt(null);
        load();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Datasets</h1>
      <p className="sub">Imported files are fingerprinted (SHA-256) and stored as immutable snapshots for audit reproducibility.</p>
      <div className="toolbar">
        <label className="btn primary" style={{ cursor: "pointer" }}>
          {busy ? "Importing…" : "Import file (CSV, Excel, JSON, Parquet)"}
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet" style={{ display: "none" }} disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <button onClick={load}>Refresh</button>
      </div>
      <ErrorBox error={error} />
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr><th>Name</th><th>Kind</th><th>Rows</th><th>Columns</th><th>Source file</th><th>Fingerprint</th><th>Imported</th><th></th></tr></thead>
          <tbody>
            {datasets.map((d) => (
              <tr key={d.id}>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td><span className="chip">{d.kind.replace(/_/g, " ")}</span></td>
                <td>{d.latestVersion?.rowCount ?? "—"}</td>
                <td>{d.latestVersion?.columns.length ?? "—"}</td>
                <td className="dim">{d.latestVersion?.sourceFileName ?? "—"}</td>
                <td className="mono small dim">{d.latestVersion?.contentHash?.slice(0, 12) ?? "—"}…</td>
                <td>{fmtDate(d.createdAt)}</td>
                <td>
                  {d.latestVersion && (
                    <button className="small" onClick={() => setPreviewId(previewId === d.latestVersion.id ? null : d.latestVersion.id)}>
                      {previewId === d.latestVersion.id ? "Hide" : "Preview"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {datasets.length === 0 && <tr><td colSpan={8} className="empty">No datasets yet. Import a file to get started.</td></tr>}
          </tbody>
        </table>
      </div>
      {previewId && (
        <div className="card" style={{ marginTop: 12 }}>
          <DataPreview datasetVersionId={previewId} />
        </div>
      )}
      {sheetPrompt && (
        <Modal title="Choose a sheet" onClose={() => setSheetPrompt(null)}>
          <p>The Excel file has multiple sheets. Which one should be imported?</p>
          {sheetPrompt.sheets.map((s) => (
            <button key={s} style={{ display: "block", marginBottom: 6, width: "100%" }} onClick={() => upload(sheetPrompt.file, s)}>{s}</button>
          ))}
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ToolkitPage({ navigate }: { navigate: (h: string) => void }) {
  const [tools, setTools] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<any[]>("/api/toolkit").then(setTools).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <h1>Toolkit</h1>
      <p className="sub">Approved, verified workflow versions published for reuse. Toolkit entries always point to immutable verified versions.</p>
      <ErrorBox error={error} />
      <div className="cards">
        {tools.map((t) => (
          <div className="card" key={t.id}>
            <h3>{t.name} <Badge status={t.status} /></h3>
            {t.category && <span className="chip">{t.category}</span>}
            <p className="small dim">{t.description || "No description."}</p>
            {t.riskStatement && <p className="small"><b>Risk:</b> {t.riskStatement}</p>}
            <p className="small dim">Published by {t.publishedBy} on {fmtDate(t.publishedAt)}</p>
            <div className="row">
              <button className="small primary" onClick={() => api.post<any>(`/api/toolkit/${t.id}/clone`, {}).then((r) => navigate(`#/workflows/${r.workflow.id}`)).catch((e) => setError(e.message))}>Clone to draft</button>
              <button className="small" style={{ flex: "0 0 auto" }} onClick={() => navigate(`#/workflows/${t.sourceWorkflowId}`)}>Open source workflow</button>
              <button className="small danger" style={{ flex: "0 0 auto" }} onClick={() => confirm(`Unpublish "${t.name}"? The source workflow and version are preserved.`) && api.post(`/api/toolkit/${t.id}/unpublish`).then(load).catch((e) => setError(e.message))}>Unpublish</button>
            </div>
          </div>
        ))}
        {tools.length === 0 && <div className="empty">Nothing published yet. Verify a workflow version, then publish it from the Versions tab.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SettingsPage() {
  const [settings, setSettings] = useState<any>({ profileName: "", reviewerName: "", testerName: "" });
  const [providers, setProviders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, any>>({});
  const [form, setForm] = useState<any>({ type: "ollama", displayName: "", baseUrl: "", model: "", apiKey: "", deployment: "", isDefault: false });

  const load = () => {
    api.get<any>("/api/settings").then(setSettings).catch(() => {});
    api.get<any[]>("/api/llm/providers").then(setProviders).catch(() => {});
  };
  useEffect(load, []);

  const addProvider = () =>
    api.post("/api/llm/providers", {
      type: form.type,
      displayName: form.displayName || undefined,
      baseUrl: form.baseUrl || undefined,
      model: form.model || undefined,
      apiKey: form.apiKey || undefined,
      deployment: form.deployment || undefined,
      isDefault: form.isDefault
    })
      .then(() => { setMsg("Provider saved."); setForm({ ...form, apiKey: "" }); load(); })
      .catch((e) => setError(e.message));

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>Settings</h1>
      <ErrorBox error={error} />
      {msg && <div className="info-box">{msg}</div>}

      <div className="card">
        <h3>Local profile</h3>
        <p className="small dim">Used as the default actor on runs, reviews, and publishes (single local user in MVP).</p>
        <div className="row">
          <label className="field"><span>Your name</span><input value={settings.profileName} onChange={(e) => setSettings({ ...settings, profileName: e.target.value })} /></label>
        </div>
        <button className="primary" onClick={() => api.put("/api/settings", settings).then(() => setMsg("Saved.")).catch((e) => setError(e.message))}>Save profile</button>
      </div>

      <div className="card">
        <h3>LLM providers</h3>
        <p className="small dim">
          Ollama (local) is the default — audit data never leaves this machine. Cloud providers are opt-in per action and require explicit selection.
        </p>
        <table className="grid">
          <thead><tr><th>Provider</th><th>Type</th><th>Kind</th><th>Default</th><th>Health</th><th></th></tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <td>{p.displayName}</td>
                <td>{p.type}</td>
                <td>{p.kind === "cloud" ? <span style={{ color: "var(--amber)" }}>cloud ⚠</span> : "local"}</td>
                <td>{p.isDefault ? "✓" : ""}</td>
                <td className="small">
                  {health[p.id] ? (health[p.id].ok ? <span style={{ color: "var(--green)" }}>{health[p.id].detail}</span> : <span style={{ color: "var(--red)" }}>{health[p.id].detail}</span>) : (
                    <button className="small" onClick={() => api.get<any>(`/api/llm/providers/${p.id}/health`).then((h) => setHealth({ ...health, [p.id]: h })).catch((e) => setHealth({ ...health, [p.id]: { ok: false, detail: e.message } }))}>Check</button>
                  )}
                </td>
                <td><button className="small ghost" onClick={() => api.del(`/api/llm/providers/${p.id}`).then(load)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ marginTop: 16 }}>Add provider</h3>
        {["openai", "azure_foundry"].includes(form.type) && (
          <div className="warn-box">Cloud provider: prompts (never raw audit data) leave this machine. API keys are encrypted at rest in the local vault.</div>
        )}
        <div className="row">
          <label className="field"><span>Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="ollama">Ollama (local)</option>
              <option value="openai">OpenAI (cloud)</option>
              <option value="azure_foundry">Azure AI Foundry (cloud)</option>
              <option value="mock">Mock (testing)</option>
            </select>
          </label>
          <label className="field"><span>Display name</span><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field"><span>Base URL {form.type === "ollama" ? "(default http://127.0.0.1:11434)" : form.type === "azure_foundry" ? "(endpoint, required)" : "(optional)"}</span>
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </label>
          <label className="field"><span>Model {form.type === "azure_foundry" ? "/ deployment" : ""}</span>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={form.type === "ollama" ? "llama3.1" : "gpt-4o-mini"} />
          </label>
        </div>
        {["openai", "azure_foundry"].includes(form.type) && (
          <label className="field"><span>API key (stored encrypted)</span><input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></label>
        )}
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Make default provider
        </label>
        <button className="primary" onClick={addProvider}>Add provider</button>
      </div>
    </div>
  );
}
