import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { ChartView } from "./chart";

export function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status.replace(/_/g, " ")}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="ghost" style={{ flex: "0 0 auto" }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-box">{error}</div>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function duration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 1234567 → "1,234,567" (row/column counts on the canvas). */
export const fmtInt = (n: number): string => n.toLocaleString("en-US");

/** Read-only data preview grid for a dataset version (features/data-preview.md).
 * When `chartType` is set (Chart node outputs), the chart renders above the table. */
export function DataPreview({ datasetVersionId, rows: limit = 100, chartType }: { datasetVersionId: string; rows?: number; chartType?: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any[] | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setProfile(null);
    api
      .get(`/api/dataset-versions/${datasetVersionId}/preview?limit=${limit}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [datasetVersionId, limit]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="dim small">Loading preview…</div>;

  return (
    <div>
      {chartType && <ChartView chartType={chartType} rows={data.rows} />}
      <div className="row small dim" style={{ margin: "6px 0", justifyContent: "space-between" }}>
        <span style={{ flex: "0 0 auto" }}>
          {data.totalRows} rows total — showing first {Math.min(limit, data.totalRows)}
        </span>
        <span style={{ flex: "0 0 auto", display: "flex", gap: 8 }}>
          <button className="small" onClick={() => api.get<any[]>(`/api/dataset-versions/${datasetVersionId}/profile`).then(setProfile).catch((e) => setError(e.message))}>
            Profile columns
          </button>
          <a className="btn small" href={`/api/dataset-versions/${datasetVersionId}/export?format=csv`}>Export CSV</a>
          <a className="btn small" href={`/api/dataset-versions/${datasetVersionId}/export?format=xlsx`}>Export Excel</a>
        </span>
      </div>
      {profile && (
        <div className="grid-wrap short" style={{ marginBottom: 8 }}>
          <table className="grid">
            <thead>
              <tr><th>Column</th><th>Type</th><th>Nulls</th><th>Distinct</th><th>Min</th><th>Max</th></tr>
            </thead>
            <tbody>
              {profile.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td><td className="dim">{p.type}</td><td>{p.nullCount}</td><td>{p.distinctCount}</td>
                  <td className="mono">{p.min === null ? "—" : String(p.min)}</td>
                  <td className="mono">{p.max === null ? "—" : String(p.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid-wrap short">
        <table className="grid">
          <thead>
            <tr>
              {data.columns.map((c: any) => (
                <th key={c.name}>
                  {c.name} <span className="dim" style={{ fontWeight: 400 }}>({c.type})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row: any, i: number) => (
              <tr key={i}>
                {data.columns.map((c: any) => {
                  const v = row[c.name];
                  return (
                    <td key={c.name} className="mono">
                      {v === null || v === undefined ? <span className="dim">null</span> : String(v).slice(0, 200)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><td colSpan={data.columns.length || 1} className="dim">No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Runtime parameter entry (features/parameters.md §3.4). */
export function ParameterInputs({
  definitions,
  values,
  onChange,
  datasets
}: {
  definitions: any[];
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
  datasets: { id: string; name: string; latestVersion: any }[];
}) {
  const set = (key: string, value: any) => onChange({ ...values, [key]: value });
  if (definitions.length === 0) return <p className="dim small">This workflow has no parameters.</p>;
  return (
    <div>
      {definitions.map((def) => {
        const v = values[def.key] ?? def.defaultValue ?? "";
        return (
          <label className="field" key={def.key}>
            <span>
              {def.label} {def.required && <span style={{ color: "var(--red)" }}>*</span>}{" "}
              <span className="dim">({def.type})</span>
              {def.description ? <span className="dim"> — {def.description}</span> : null}
            </span>
            {def.type === "dataset" ? (
              <select value={v ?? ""} onChange={(e) => set(def.key, e.target.value || null)}>
                <option value="">— choose a dataset —</option>
                {datasets
                  .filter((d) => d.latestVersion)
                  .map((d) => (
                    <option key={d.id} value={d.latestVersion.id}>
                      {d.name} ({d.latestVersion.rowCount} rows)
                    </option>
                  ))}
              </select>
            ) : def.type === "boolean" ? (
              <select value={String(v)} onChange={(e) => set(def.key, e.target.value === "true")}>
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            ) : def.type === "enum" ? (
              <select value={v ?? ""} onChange={(e) => set(def.key, e.target.value)}>
                <option value="">—</option>
                {(def.allowedValues ?? []).map((a: string) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            ) : def.type === "date" ? (
              <input type="date" value={v ?? ""} onChange={(e) => set(def.key, e.target.value)} />
            ) : def.type === "integer" || def.type === "decimal" ? (
              <input
                type="number"
                step={def.type === "integer" ? 1 : "any"}
                value={v ?? ""}
                onChange={(e) => set(def.key, e.target.value === "" ? null : Number(e.target.value))}
              />
            ) : (
              <input value={v ?? ""} onChange={(e) => set(def.key, e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}
