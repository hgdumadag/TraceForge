/** Workflow detail: canvas builder, parameters, run history, versions, verification. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node as RFNode, Edge as RFEdge } from "@xyflow/react";
import { getNodeType, newId } from "@traceforge/domain";
import { api, type VersionRow } from "./api";
import { Badge, ErrorBox, Modal, DataPreview, ParameterInputs, fmtDate, duration } from "./components";
import { FlowCanvas, Palette, toRfGraph, fromRfGraph } from "./canvas";
import { NodeConfigPanel } from "./nodeconfig";

export function WorkflowPage({ workflowId, navigate }: { workflowId: string; navigate: (h: string) => void }) {
  const [data, setData] = useState<{ workflow: any; versions: VersionRow[] } | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [version, setVersion] = useState<VersionRow | null>(null);
  const [tab, setTab] = useState("canvas");
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<any[]>([]);

  const reload = useCallback(async (keepVersion = true) => {
    try {
      const d = await api.get<any>(`/api/workflows/${workflowId}`);
      setData(d);
      const targetId = (keepVersion && versionId) || d.workflow.activeVersionId || d.versions[0]?.id;
      if (targetId) {
        setVersionId(targetId);
        setVersion(await api.get<VersionRow>(`/api/versions/${targetId}`));
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [workflowId, versionId]);

  useEffect(() => {
    reload(false);
    api.get<any[]>("/api/datasets").then(setDatasets).catch(() => {});
  }, [workflowId]);

  const selectVersion = async (id: string) => {
    setVersionId(id);
    setVersion(await api.get<VersionRow>(`/api/versions/${id}`));
    setTab("canvas");
  };

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data || !version) return <div className="page dim">Loading…</div>;

  const wf = data.workflow;
  const readOnly = version.status !== "draft";

  return (
    <div className="page wide">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>
            <a onClick={() => navigate("#/")} style={{ cursor: "pointer" }}>Workflows</a> / {wf.name}{" "}
            <Badge status={version.status} /> {wf.status === "archived" && <Badge status="archived" />}
          </h1>
          <p className="sub">
            v{version.versionNumber} · {wf.category || "Uncategorized"} · updated {fmtDate(version.updatedAt)}
            {readOnly ? " · read-only (create a draft to edit)" : ""}
          </p>
        </div>
        <div style={{ flex: "0 0 auto" }} className="row">
          <select value={versionId ?? ""} onChange={(e) => selectVersion(e.target.value)}>
            {data.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber} — {v.status}{v.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tabs">
        {["canvas", "parameters", "runs", "versions", "verification", "details"].map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {{ canvas: "Canvas", parameters: "Parameters", runs: "Run History", versions: "Versions", verification: "Verification", details: "Details" }[t]}
          </button>
        ))}
      </div>

      {tab === "canvas" && (
        <CanvasTab key={version.id} version={version} datasets={datasets} readOnly={readOnly} onVersionChanged={() => reload()} navigateVersion={selectVersion} />
      )}
      {tab === "parameters" && <ParametersTab version={version} readOnly={readOnly} onChanged={() => selectVersion(version.id)} />}
      {tab === "runs" && <RunsTab workflowId={workflowId} datasets={datasets} />}
      {tab === "versions" && (
        <VersionsTab versions={data.versions} onSelect={selectVersion} onChanged={() => reload()} currentId={version.id} />
      )}
      {tab === "verification" && (
        <VerificationTab version={version} datasets={datasets} onChanged={() => { reload(); selectVersion(version.id); }} />
      )}
      {tab === "details" && <DetailsTab workflow={wf} version={version} readOnly={readOnly} onChanged={() => reload()} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CanvasTab({
  version,
  datasets,
  readOnly,
  onVersionChanged,
  navigateVersion
}: {
  version: VersionRow;
  datasets: any[];
  readOnly: boolean;
  onVersionChanged: () => void;
  navigateVersion: (id: string) => void;
}) {
  const initial = useMemo(() => toRfGraph(version.graph, {}), [version.id]);
  const [rfNodes, setRfNodes] = useState<RFNode[]>(initial.nodes);
  const [rfEdges, setRfEdges] = useState<RFEdge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [execution, setExecution] = useState<any>(null);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, string>>({});
  const [nodeOutputs, setNodeOutputs] = useState<Record<string, Record<string, string>>>({});
  const [nodeSummaries, setNodeSummaries] = useState<Record<string, Record<string, { rows: number; columns: number }>>>({});
  const [previewDsv, setPreviewDsv] = useState<{ id: string; label: string; chartType?: string } | null>(null);
  const [upstreamCols, setUpstreamCols] = useState<Record<string, string>>({});
  const sseClose = useRef<(() => void) | null>(null);

  // Apply node execution statuses + row-count summaries onto canvas nodes.
  useEffect(() => {
    setRfNodes((nodes) =>
      nodes.map((n) =>
        n.type === "tfNode" ? { ...n, data: { ...n.data, status: nodeStatuses[n.id], summary: nodeSummaries[n.id] } } : n
      )
    );
  }, [nodeStatuses, nodeSummaries]);

  // Inspector collapses when nothing is selected (nothing to configure) and expands the
  // moment a node is selected. The user can still toggle it manually at any time — collapsing
  // while a node is selected persists until a different node is selected or it is deselected.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  useEffect(() => {
    setInspectorCollapsed(!selectedId);
  }, [selectedId]);

  const selectedNode = rfNodes.find((n) => n.id === selectedId && n.type === "tfNode");

  // Resolve upstream columns for the selected node (for column pickers + expression validation).
  // Walks the graph upstream: dataset bindings are the source of truth for import nodes, and
  // the schema is propagated statically through nodes whose column shape is predictable from
  // CURRENT config — this must run before consulting any cached run output, so that editing an
  // upstream node (e.g. changing a column's type in Edit Columns) is reflected immediately,
  // even if that node was last run under an older config. The last run's recorded output is
  // used only as a fallback, for ports whose schema genuinely can't be simulated from config
  // (Pivot, Python, Chart, AI nodes, API import, and Validate's engine-generated summary output).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUpstreamCols({});
      if (!selectedNode) return;
      const def = getNodeType((selectedNode.data as any).nodeType as string);
      if (def && def.inputs.length === 0) return;

      const fetchCols = async (dsvId: string): Promise<Record<string, string> | null> => {
        try {
          const p = await api.get<any>(`/api/dataset-versions/${dsvId}/preview?limit=1`);
          const out: Record<string, string> = {};
          for (const c of p.columns) out[c.name] = c.type;
          return out;
        } catch { return null; }
      };

      const outputColumns = async (nid: string, handle: string, depth: number): Promise<Record<string, string> | null> => {
        if (depth > 32) return null;
        const node = rfNodes.find((n) => n.id === nid);
        if (!node) return null;
        const type = (node.data as any).nodeType as string;
        const cfg = (node.data as any).config ?? {};

        // Exact sources whose schema IS the current config, not a simulation of it.
        if (type === "import_file") return cfg.datasetVersionId ? fetchCols(cfg.datasetVersionId) : null;
        if (type === "import_sample") {
          const sample = datasets.find((d) => d.id === cfg.sampleId || d.name === cfg.sampleId);
          return sample?.latestVersion ? fetchCols(sample.latestVersion.id) : null;
        }
        if (type === "new_table") {
          const out: Record<string, string> = {};
          for (const c of cfg.columns ?? []) if (c.name) out[c.name] = c.type ?? "unknown";
          return Object.keys(out).length ? out : null;
        }

        const inputSchema = async (port?: string): Promise<Record<string, string> | null> => {
          const edge = rfEdges.find((e) => e.target === nid && (!port || (e.targetHandle ?? "input") === port));
          if (!edge) return null;
          const srcType = (rfNodes.find((n) => n.id === edge.source)?.data as any)?.nodeType as string | undefined;
          const srcHandle = edge.sourceHandle ?? getNodeType(srcType ?? "")?.outputs[0]?.name ?? "output";
          return outputColumns(edge.source, srcHandle, depth + 1);
        };

        const simulated = await (async (): Promise<Record<string, string> | null> => {
          switch (type) {
            // Shape-preserving nodes (all outputs carry the input schema).
            case "find_replace": case "sample": case "sort": case "filter":
            case "deduplicate": case "overwrite_columns": case "append":
              return inputSchema();
            case "validate": {
              if (handle !== "exceptions") return null; // summary schema is engine-generated
              const input = await inputSchema();
              if (!input) return null;
              const keep: string[] = cfg.outputColumns?.length ? cfg.outputColumns : Object.keys(input);
              const out: Record<string, string> = {};
              for (const k of keep) if (input[k]) out[k] = input[k];
              return out;
            }
            case "select_columns": {
              const input = await inputSchema();
              if (!input) return null;
              const out: Record<string, string> = {};
              for (const k of cfg.columns ?? []) if (input[k]) out[k] = input[k];
              return Object.keys(out).length ? out : null;
            }
            case "add_columns": {
              const input = await inputSchema();
              if (!input) return null;
              const out = { ...input };
              for (const c of cfg.columns ?? []) if (c.name) out[c.name] = "unknown";
              return out;
            }
            case "edit_columns": {
              const input = await inputSchema();
              if (!input) return null;
              const edits = new Map<string, any>((cfg.edits ?? []).map((e: any) => [e.column, e]));
              const out: Record<string, string> = {};
              for (const [name, t] of Object.entries(input)) {
                const e = edits.get(name);
                out[e?.rename || name] = e?.newType ?? t;
              }
              return out;
            }
            case "text_to_columns": {
              const input = await inputSchema();
              if (!input) return null;
              const out = { ...input };
              for (const n of cfg.newColumns ?? []) if (n) out[n] = "text";
              return out;
            }
            case "parse_json": {
              const input = await inputSchema();
              if (!input) return null;
              const out = { ...input };
              for (const f of cfg.fields ?? []) if (f.name) out[f.name] = "text";
              return out;
            }
            case "join": {
              const left = await inputSchema("left");
              const right = await inputSchema("right");
              if (!left) return null;
              if (!right) return left; // partial knowledge still beats free-text
              const out = { ...left };
              for (const [name, t] of Object.entries(right)) {
                out[name in left ? `${name}${cfg.rightSuffix ?? "_right"}` : name] = t;
              }
              return out;
            }
            case "unpivot": {
              const input = await inputSchema();
              if (!input) return null;
              const out: Record<string, string> = {};
              for (const k of cfg.idColumns ?? []) if (input[k]) out[k] = input[k];
              out[cfg.nameTo || "name"] = "text";
              out[cfg.valueTo || "value"] = "unknown";
              return out;
            }
            default:
              return null; // pivot, python, chart, AI, import_api: schema unknown before a run
          }
        })();
        if (simulated) return simulated;

        // Fallback: the schema actually produced by this node/port's last real run, used only
        // when the current config can't be simulated (see cases above that return null).
        const fromRun = nodeOutputs[nid]?.[handle];
        if (fromRun) return fetchCols(fromRun);
        return null;
      };

      const incoming = rfEdges.find((e) => e.target === selectedNode.id);
      if (!incoming) return;
      const srcType = (rfNodes.find((n) => n.id === incoming.source)?.data as any)?.nodeType as string | undefined;
      const handle = incoming.sourceHandle ?? getNodeType(srcType ?? "")?.outputs[0]?.name ?? "output";
      const cols = await outputColumns(incoming.source, handle, 0);
      if (!cancelled && cols) setUpstreamCols(cols);
    })();
    return () => { cancelled = true; };
  }, [selectedId, rfEdges.length, nodeOutputs]);

  const addNode = (type: string) => {
    const offset = rfNodes.length * 24;
    if (type === "__note") {
      const id = `ann_${newId("note")}`;
      setRfNodes((n) => [
        ...n,
        { id, type: "tfNote", position: { x: 120 + offset, y: 80 + offset }, width: 220, height: 120, data: { text: "New note — explain the audit objective here." } }
      ]);
    } else {
      const def = getNodeType(type)!;
      const id = newId("node");
      setRfNodes((n) => [...n, { id, type: "tfNode", position: { x: 120 + offset, y: 80 + offset }, data: { label: def.label, nodeType: type, config: {} } }]);
      setSelectedId(id);
    }
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    try {
      const graph = fromRfGraph(rfNodes, rfEdges);
      await api.put(`/api/versions/${version.id}`, { graph });
      setDirty(false);
      setError(null);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const run = async (parameterValues: Record<string, any>) => {
    if (dirty && !readOnly) {
      const ok = await save();
      if (!ok) return;
    }
    setRunOpen(false);
    setNodeStatuses({});
    setNodeSummaries({});
    setError(null);
    try {
      const exec = await api.post<any>(`/api/versions/${version.id}/run`, { parameterValues });
      setExecution(exec);
      sseClose.current?.();
      sseClose.current = api.events(exec.id, (event) => {
        if (event.type === "node") {
          setNodeStatuses((s) => ({ ...s, [event.data.nodeId]: event.data.status }));
          if (event.data.outputDatasetVersionIds && Object.keys(event.data.outputDatasetVersionIds).length) {
            setNodeOutputs((o) => ({ ...o, [event.data.nodeId]: event.data.outputDatasetVersionIds }));
          }
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
          if (event.data.error) setError((prev) => prev ?? event.data.error);
        }
        if (event.type === "done") {
          setExecution((e: any) => ({ ...e, status: event.data.status, errorSummary: event.data.errorSummary }));
          if (event.data.errorSummary) setError(event.data.errorSummary);
          sseClose.current?.();
        }
      });
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => () => sseClose.current?.(), []);

  const selectedOutputs = selectedId ? nodeOutputs[selectedId] : undefined;

  return (
    <div>
      <div className="toolbar">
        {!readOnly && (
          <button className="primary" onClick={save} disabled={!dirty}>
            {dirty ? "Save changes" : "Saved"}
          </button>
        )}
        {readOnly && (
          <button
            onClick={async () => {
              const draft = await api.post<any>(`/api/versions/${version.id}/draft`);
              // Refresh the version list BEFORE navigating; firing both
              // concurrently lets the stale reload overwrite the selection.
              await onVersionChanged();
              await navigateVersion(draft.id);
            }}
          >
            Create draft from v{version.versionNumber}
          </button>
        )}
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
        <button className="primary run" onClick={() => setRunOpen(true)}>▶ Run</button>
        {execution && (
          <span className="row" style={{ flex: "0 0 auto" }}>
            <Badge status={execution.status} />
            {["queued", "running"].includes(execution.status) && (
              <button className="small" onClick={() => api.post(`/api/executions/${execution.id}/cancel`)}>Cancel</button>
            )}
          </span>
        )}
        <span className="spacer" />
        {!readOnly &&
          (dirty ? (
            <span className="save-state dirty">● Unsaved changes</span>
          ) : (
            <span className="save-state saved">● All changes saved</span>
          ))}
      </div>
      <ErrorBox error={error} />
      <div className="canvas-layout">
        <Palette onAdd={addNode} readOnly={readOnly} />
        <FlowCanvas
          rfNodes={rfNodes}
          rfEdges={rfEdges}
          setRfNodes={(u) => setRfNodes(u)}
          setRfEdges={(u) => setRfEdges(u)}
          onSelect={setSelectedId}
          onDirty={() => setDirty(true)}
          readOnly={readOnly}
        />
        <div className={`inspector ${inspectorCollapsed ? "collapsed" : ""}`}>
          <div className="inspector-head">
            <button
              className="sidebar-toggle"
              onClick={() => setInspectorCollapsed((c) => !c)}
              title={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
              aria-label={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
            >
              {inspectorCollapsed ? "«" : "»"}
            </button>
          </div>
          <div style={{ display: inspectorCollapsed ? "none" : undefined }}>
          {selectedNode ? (
            <>
              <NodeConfigPanel
                node={{ id: selectedNode.id, type: (selectedNode.data as any).nodeType, label: (selectedNode.data as any).label, config: (selectedNode.data as any).config }}
                upstreamColumns={upstreamCols}
                parameters={version.parameters}
                datasets={datasets}
                readOnly={readOnly}
                onSave={({ label, config }) => {
                  setRfNodes((nodes) => nodes.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, label, config } } : n)));
                  setDirty(true);
                }}
                onDelete={() => {
                  if (!confirm("Delete this node? Connected edges are removed too.")) return;
                  setRfNodes((nodes) => nodes.filter((n) => n.id !== selectedNode.id));
                  setRfEdges((edges) => edges.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelectedId(null);
                  setDirty(true);
                }}
              />
              {selectedOutputs && Object.keys(selectedOutputs).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <h3>Last run outputs</h3>
                  {Object.entries(selectedOutputs).map(([handle, dsvId]) => (
                    <button
                      key={handle}
                      className="small"
                      style={{ marginRight: 6, marginBottom: 6 }}
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
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="dim small">
              <h3 style={{ color: "var(--text)" }}>Inspector</h3>
              Select a node to configure it. Add nodes from the palette on the left. Connect outputs (right) to inputs (left).
              {Object.keys(nodeOutputs).length > 0 && <p>Run complete — select a node to preview its outputs.</p>}
            </div>
          )}
          </div>
        </div>
      </div>
      {previewDsv && (
        <div className="preview-drawer">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{previewDsv.label}</h3>
            <button className="ghost small" style={{ flex: "0 0 auto" }} onClick={() => setPreviewDsv(null)}>Close</button>
          </div>
          <DataPreview datasetVersionId={previewDsv.id} chartType={previewDsv.chartType} />
        </div>
      )}
      {runOpen && (
        <RunModal version={version} datasets={datasets} onRun={run} onClose={() => setRunOpen(false)} />
      )}
    </div>
  );
}

function RunModal({ version, datasets, onRun, onClose }: { version: VersionRow; datasets: any[]; onRun: (v: Record<string, any>) => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const v: Record<string, any> = {};
    for (const d of version.parameters) if (d.defaultValue !== undefined && d.defaultValue !== null) v[d.key] = d.defaultValue;
    return v;
  });
  const missing = version.parameters.filter((d: any) => d.required && (values[d.key] === undefined || values[d.key] === null || values[d.key] === ""));
  return (
    <Modal title={`Run v${version.versionNumber}`} onClose={onClose}>
      <ParameterInputs definitions={version.parameters} values={values} onChange={setValues} datasets={datasets} />
      {missing.length > 0 && <div className="warn-box">Required: {missing.map((m: any) => m.label).join(", ")}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={missing.length > 0} onClick={() => onRun(values)}>Run workflow</button>
        <button onClick={onClose} style={{ flex: "0 0 auto" }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ParametersTab({ version, readOnly, onChanged }: { version: VersionRow; readOnly: boolean; onChanged: () => void }) {
  const [params, setParams] = useState<any[]>(version.parameters);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setParams(version.parameters), [version.id]);

  const save = async () => {
    try {
      await api.put(`/api/versions/${version.id}`, { parameters: params });
      setError(null);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={{ maxWidth: 800 }}>
      <p className="sub">Typed parameters make audit tests reusable. Reference them in expressions as {"{param!key}"}.</p>
      <ErrorBox error={error} />
      {params.map((p, i) => (
        <div className="card" key={i}>
          <div className="row">
            <label className="field"><span>Key (a-z, 0-9, _)</span><input disabled={readOnly} value={p.key} onChange={(e) => setParams(params.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} /></label>
            <label className="field"><span>Label</span><input disabled={readOnly} value={p.label} onChange={(e) => setParams(params.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></label>
            <label className="field"><span>Type</span>
              <select disabled={readOnly} value={p.type} onChange={(e) => setParams(params.map((x, j) => j === i ? { ...x, type: e.target.value, defaultValue: undefined } : x))}>
                {["text", "integer", "decimal", "boolean", "date", "enum", "dataset"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="field"><span>Required</span>
              <select disabled={readOnly} value={String(p.required ?? false)} onChange={(e) => setParams(params.map((x, j) => j === i ? { ...x, required: e.target.value === "true" } : x))}>
                <option value="false">No</option><option value="true">Yes</option>
              </select>
            </label>
            {!readOnly && <button className="ghost small" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={() => setParams(params.filter((_, j) => j !== i))}>✕</button>}
          </div>
          <div className="row">
            {p.type !== "dataset" && (
              <label className="field"><span>Default value</span>
                <input disabled={readOnly} value={p.defaultValue ?? ""} onChange={(e) => {
                  const raw = e.target.value;
                  const v = p.type === "integer" || p.type === "decimal" ? (raw === "" ? undefined : Number(raw)) : p.type === "boolean" ? raw === "true" : raw || undefined;
                  setParams(params.map((x, j) => j === i ? { ...x, defaultValue: v } : x));
                }} />
              </label>
            )}
            {p.type === "enum" && (
              <label className="field"><span>Allowed values (comma-separated)</span>
                <input disabled={readOnly} value={(p.allowedValues ?? []).join(",")} onChange={(e) => setParams(params.map((x, j) => j === i ? { ...x, allowedValues: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x))} />
              </label>
            )}
            <label className="field"><span>Description</span>
              <input disabled={readOnly} value={p.description ?? ""} onChange={(e) => setParams(params.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
            </label>
          </div>
        </div>
      ))}
      {!readOnly && (
        <div className="toolbar">
          <button onClick={() => setParams([...params, { key: "", label: "", type: "text", required: false }])}>+ Add parameter</button>
          <button className="primary" onClick={save}>Save parameters</button>
        </div>
      )}
      {readOnly && <div className="info-box">Parameter definitions are immutable on {version.status} versions. Runtime values can still be set per run.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RunsTab({ workflowId, datasets }: { workflowId: string; datasets: any[] }) {
  const [executions, setExecutions] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<any[]>(`/api/executions?workflowId=${workflowId}`).then(setExecutions).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [workflowId]);

  useEffect(() => {
    if (!openId) return setDetail(null);
    api.get<any>(`/api/executions/${openId}`).then(setDetail).catch((e) => setError(e.message));
  }, [openId]);

  return (
    <div>
      <div className="toolbar">
        <button onClick={load}>Refresh</button>
      </div>
      <ErrorBox error={error} />
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr><th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th><th>Run by</th><th>Parameters</th><th></th></tr>
          </thead>
          <tbody>
            {executions.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => setOpenId(openId === e.id ? null : e.id)}>
                <td><Badge status={e.status} /></td>
                <td>{e.triggerType}{e.rerunOfExecutionId ? " (rerun)" : ""}</td>
                <td>{fmtDate(e.startedAt)}</td>
                <td>{duration(e.startedAt, e.finishedAt)}</td>
                <td>{e.createdBy || "local"}</td>
                <td className="mono small">{Object.entries(e.parameterValues).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(", ") || "—"}</td>
                <td>
                  <button className="small" onClick={(ev) => { ev.stopPropagation(); api.post(`/api/executions/${e.id}/rerun`).then(load).catch((er) => setError(er.message)); }}>Rerun</button>
                </td>
              </tr>
            ))}
            {executions.length === 0 && <tr><td colSpan={7} className="empty">No runs yet. Open the canvas and click Run.</td></tr>}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Execution {detail.execution.id} <Badge status={detail.execution.status} /></h3>
            <span style={{ flex: "0 0 auto", display: "flex", gap: 6 }}>
              <a className="btn small" href={`/api/executions/${detail.execution.id}/evidence?format=markdown`} target="_blank">Evidence (Markdown)</a>
              <a className="btn small" href={`/api/executions/${detail.execution.id}/evidence`} target="_blank">Evidence (JSON)</a>
            </span>
          </div>
          {detail.execution.errorSummary && <div className="error-box">{detail.execution.errorSummary}</div>}
          <table className="grid" style={{ marginTop: 8 }}>
            <thead><tr><th>Node</th><th>Status</th><th>Duration</th><th>Outputs</th><th>Error</th></tr></thead>
            <tbody>
              {detail.nodeExecutions.map((n: any) => (
                <tr key={n.id}>
                  <td>{n.nodeLabel} <span className="dim small">({n.nodeType})</span></td>
                  <td><Badge status={n.status} /></td>
                  <td>{duration(n.startedAt, n.finishedAt)}</td>
                  <td>
                    {Object.entries(n.outputDatasetVersionIds).map(([handle, id]) => (
                      <a key={handle} className="small" style={{ marginRight: 8 }} href={`/api/dataset-versions/${id}/export?format=csv`}>{handle} ⬇</a>
                    ))}
                  </td>
                  <td className="small" style={{ color: "var(--red)" }}>{n.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.nodeExecutions.some((n: any) => n.logs.length) && (
            <>
              <h3>Logs</h3>
              <div className="mono small dim">{detail.nodeExecutions.flatMap((n: any) => n.logs).map((l: string, i: number) => <div key={i}>{l}</div>)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function VersionsTab({ versions, currentId, onSelect, onChanged }: { versions: VersionRow[]; currentId: string; onSelect: (id: string) => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [publishFor, setPublishFor] = useState<VersionRow | null>(null);
  const act = (fn: () => Promise<any>) => fn().then(onChanged).catch((e) => setError(e.message));

  return (
    <div>
      <ErrorBox error={error} />
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Source</th><th>Tester / Reviewer</th><th>Activated</th><th>Actions</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className={v.id === currentId ? "" : "clickable"} onClick={() => onSelect(v.id)}>
                <td>v{v.versionNumber} {v.isActive && <Badge status="active" />}</td>
                <td><Badge status={v.status} /></td>
                <td>{fmtDate(v.createdAt)} <span className="dim">by {v.createdBy || "local"}</span></td>
                <td className="dim small">{v.sourceVersionId ? `from ${versions.find((x) => x.id === v.sourceVersionId)?.versionNumber ? "v" + versions.find((x) => x.id === v.sourceVersionId)!.versionNumber : "…"}` : "—"}</td>
                <td className="small">{v.verification ? `${v.verification.tester || "—"} / ${v.verification.reviewer || "—"}` : "—"}</td>
                <td className="small">{v.activatedAt ? `${fmtDate(v.activatedAt)} by ${v.activatedBy}` : "—"}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {v.status === "draft" && <button className="small" onClick={() => act(() => api.post(`/api/versions/${v.id}/submit`))}>Submit for review</button>}
                  {v.status === "verified" && (
                    <>
                      <button className="small primary" onClick={() => act(() => api.post(`/api/versions/${v.id}/activate`))}>Activate</button>{" "}
                      <button className="small" onClick={() => setPublishFor(v)}>Publish to toolkit</button>
                    </>
                  )}
                  {v.status === "active" && <button className="small" onClick={() => setPublishFor(v)}>Publish to toolkit</button>}
                  {(v.status === "active" || v.status === "verified" || v.status === "superseded") && (
                    <button className="small" onClick={() => act(() => api.post(`/api/versions/${v.id}/draft`))}>New draft from this</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {publishFor && <PublishModal version={publishFor} onClose={() => setPublishFor(null)} onDone={() => { setPublishFor(null); onChanged(); }} onError={setError} />}
    </div>
  );
}

function PublishModal({ version, onClose, onDone, onError }: { version: VersionRow; onClose: () => void; onDone: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [risk, setRisk] = useState("");
  return (
    <Modal title={`Publish v${version.versionNumber} to toolkit`} onClose={onClose}>
      <p className="sub">Published tools point to this immutable verified version and appear in the template library for reuse.</p>
      <label className="field"><span>Tool name (defaults to workflow name)</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Category</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Payroll, P2P, T&E" /></label>
      <label className="field"><span>Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="field"><span>Risk addressed</span><textarea value={risk} onChange={(e) => setRisk(e.target.value)} /></label>
      <div className="row">
        <button
          className="primary"
          onClick={() =>
            api.post(`/api/versions/${version.id}/publish`, { name: name || undefined, category: category || undefined, description: description || undefined, riskStatement: risk || undefined })
              .then(onDone)
              .catch((e) => { onError(e.message); onClose(); })
          }
        >
          Publish
        </button>
        <button onClick={onClose} style={{ flex: "0 0 auto" }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function VerificationTab({ version, datasets, onChanged }: { version: VersionRow; datasets: any[]; onChanged: () => void }) {
  const [review, setReview] = useState<any>(version.verification ?? null);
  const [tester, setTester] = useState(review?.tester ?? "");
  const [reviewer, setReviewer] = useState(review?.reviewer ?? "");
  const [testing, setTesting] = useState(review?.testingPerformed ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleExec, setSampleExec] = useState<any>(null);
  // Render the form only after the stored review is loaded; otherwise the
  // async fetch can resolve mid-edit and wipe what the user just typed.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/api/versions/${version.id}/verification`).then((r) => {
      setReview(r);
      if (r) {
        setTester(r.tester ?? "");
        setReviewer(r.reviewer ?? "");
        setTesting(r.testingPerformed ?? "");
        if (r.sampleExecutionId) api.get<any>(`/api/executions/${r.sampleExecutionId}`).then((d) => setSampleExec(d.execution)).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [version.id]);

  const saveDetails = () =>
    api.put<any>(`/api/versions/${version.id}/verification`, { tester, reviewer, testingPerformed: testing })
      .then(setReview)
      .catch((e) => setError(e.message));

  const decide = (decision: "pass" | "fail" | "amend") =>
    api.post(`/api/versions/${version.id}/decide`, { decision, notes, reviewer })
      .then(() => onChanged())
      .catch((e) => setError(e.message));

  if (version.status === "draft") {
    return (
      <div className="info-box" style={{ maxWidth: 700 }}>
        This version is a draft. Submit it for review from the Versions tab to begin verification.
        Verification requires a tester, a reviewer, a successful sample run, and a pass decision — then the version becomes verified and immutable.
      </div>
    );
  }

  if (loading) return <div className="dim small">Loading verification record…</div>;

  return (
    <div style={{ maxWidth: 780 }}>
      <ErrorBox error={error} />
      {review?.decision && (
        <div className={review.decision === "pass" ? "info-box" : "warn-box"}>
          Decision: <b>{review.decision}</b> by {review.reviewer} at {fmtDate(review.decidedAt)}. {review.decisionNotes}
        </div>
      )}
      <div className="card">
        <h3>Tester & reviewer</h3>
        <div className="row">
          <label className="field"><span>Tester</span><input value={tester} onChange={(e) => setTester(e.target.value)} /></label>
          <label className="field"><span>Reviewer</span><input value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></label>
        </div>
        <label className="field"><span>Testing performed</span><textarea value={testing} onChange={(e) => setTesting(e.target.value)} placeholder="What was tested, with which data, and what was checked." /></label>
        <button onClick={saveDetails} disabled={version.status !== "in_review"}>Save details</button>
      </div>

      <div className="card">
        <h3>Sample run</h3>
        <p className="small dim">A successful sample run linked to this review is required before Pass. Unverified output is for review only.</p>
        {sampleExec && (
          <p className="small">
            Linked sample run: <Badge status={sampleExec.status} /> started {fmtDate(sampleExec.startedAt)}{" "}
            <a href={`/api/executions/${sampleExec.id}/evidence?format=markdown`} target="_blank">evidence</a>
          </p>
        )}
        <button onClick={() => setSampleOpen(true)} disabled={version.status !== "in_review"}>Run sample</button>
      </div>

      <div className="card">
        <h3>Decision</h3>
        <label className="field"><span>Decision notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="row">
          <button className="primary" disabled={version.status !== "in_review"} onClick={() => decide("pass")}>Pass — mark verified</button>
          <button disabled={version.status !== "in_review"} onClick={() => decide("amend")}>Amend — back to draft</button>
          <button className="danger" disabled={version.status !== "in_review"} onClick={() => decide("fail")}>Fail</button>
        </div>
      </div>

      {sampleOpen && (
        <SampleRunModal version={version} datasets={datasets} onClose={() => setSampleOpen(false)} onStarted={(exec) => { setSampleExec(exec); setSampleOpen(false); }} onError={setError} />
      )}
    </div>
  );
}

function SampleRunModal({ version, datasets, onClose, onStarted, onError }: { version: VersionRow; datasets: any[]; onClose: () => void; onStarted: (e: any) => void; onError: (m: string) => void }) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const v: Record<string, any> = {};
    for (const d of version.parameters) if (d.defaultValue !== undefined && d.defaultValue !== null) v[d.key] = d.defaultValue;
    return v;
  });
  return (
    <Modal title="Verification sample run" onClose={onClose}>
      <ParameterInputs definitions={version.parameters} values={values} onChange={setValues} datasets={datasets} />
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="primary"
          onClick={() =>
            api.post<any>(`/api/versions/${version.id}/verification/sample-run`, { parameterValues: values })
              .then(onStarted)
              .catch((e) => { onError(e.message); onClose(); })
          }
        >
          Start sample run
        </button>
        <button onClick={onClose} style={{ flex: "0 0 auto" }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function DetailsTab({ workflow, version, readOnly, onChanged }: { workflow: any; version: VersionRow; readOnly: boolean; onChanged: () => void }) {
  const [meta, setMeta] = useState({ name: workflow.name, description: workflow.description, category: workflow.category, type: workflow.type, owner: workflow.owner });
  const [vFields, setVFields] = useState({
    notes: version.notes,
    businessCase: version.businessCase,
    requirementsAndDesignConsiderations: version.requirementsAndDesignConsiderations
  });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 780 }}>
      <ErrorBox error={error} />
      {msg && <div className="info-box">{msg}</div>}
      <div className="card">
        <h3>Workflow metadata</h3>
        <div className="row">
          <label className="field"><span>Name</span><input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
          <label className="field"><span>Service / category</span><input value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field"><span>Type</span><input value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value })} /></label>
          <label className="field"><span>Owner</span><input value={meta.owner} onChange={(e) => setMeta({ ...meta, owner: e.target.value })} /></label>
        </div>
        <label className="field"><span>Description</span><textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></label>
        <button className="primary" onClick={() => api.patch(`/api/workflows/${workflow.id}`, meta).then(() => { setMsg("Saved."); onChanged(); }).catch((e) => setError(e.message))}>Save metadata</button>
      </div>
      <div className="card">
        <h3>Version v{version.versionNumber} documentation {readOnly && <span className="dim small">(read-only)</span>}</h3>
        <label className="field"><span>Notes</span><textarea disabled={readOnly} value={vFields.notes} onChange={(e) => setVFields({ ...vFields, notes: e.target.value })} /></label>
        <label className="field"><span>Business case</span><textarea disabled={readOnly} value={vFields.businessCase} onChange={(e) => setVFields({ ...vFields, businessCase: e.target.value })} /></label>
        <label className="field"><span>Requirements & design considerations</span><textarea disabled={readOnly} value={vFields.requirementsAndDesignConsiderations} onChange={(e) => setVFields({ ...vFields, requirementsAndDesignConsiderations: e.target.value })} /></label>
        {!readOnly && <button className="primary" onClick={() => api.put(`/api/versions/${version.id}`, vFields).then(() => setMsg("Saved.")).catch((e) => setError(e.message))}>Save documentation</button>}
      </div>
      <div className="card">
        <h3>Danger zone</h3>
        <p className="small dim">Archive hides the workflow and unpublishes toolkit entries; evidence and run history are preserved. Permanent delete is only possible for never-run, never-verified drafts.</p>
        <div className="row">
          {workflow.status !== "archived"
            ? <button onClick={() => confirm("Archive this workflow? Evidence is preserved and it can be restored.") && api.post(`/api/workflows/${workflow.id}/archive`).then(onChanged).catch((e) => setError(e.message))}>Archive workflow</button>
            : <button onClick={() => api.post(`/api/workflows/${workflow.id}/restore`).then(onChanged).catch((e) => setError(e.message))}>Restore workflow</button>}
          <button className="danger" onClick={() => confirm("Permanently delete? This only works for unexecuted, unverified drafts.") && api.del(`/api/workflows/${workflow.id}`).then(() => (location.hash = "#/")).catch((e) => setError(e.message))}>
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
