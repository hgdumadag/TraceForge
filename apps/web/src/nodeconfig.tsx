/** Schema-driven node configuration panel (features/node-configuration.md).
 * Structured forms for every MVP node type, with expression validation. */
import { useEffect, useMemo, useState } from "react";
import { validateNodeConfig, getNodeType, validateExpression } from "@traceforge/domain";
import { api } from "./api";

type Cfg = Record<string, any>;

/**
 * Common source formats offered when Edit Columns converts text → date/datetime.
 * `format` is a DuckDB strptime pattern (https://duckdb.org/docs/sql/functions/dateformat):
 *   %Y = 4-digit year, %m = 2-digit month, %d = 2-digit day,
 *   %H:%M:%S = time, %b = abbreviated month name (Jul), %B = full month name (July)
 * Anything not covered here can be typed directly via "Custom format" in the picker.
 */
const DATE_FORMATS: { label: string; format: string }[] = [
  { label: "20260730 (YYYYMMDD)", format: "%Y%m%d" },
  { label: "20260730143000 (YYYYMMDDHHMMSS)", format: "%Y%m%d%H%M%S" },
  { label: "07/30/2026 (MM/DD/YYYY)", format: "%m/%d/%Y" },
  { label: "30/07/2026 (DD/MM/YYYY)", format: "%d/%m/%Y" },
  { label: "2026-07-30 14:30:00 (ISO with time)", format: "%Y-%m-%d %H:%M:%S" },
  { label: "30-Jul-2026", format: "%d-%b-%Y" },
  { label: "Jul 30, 2026", format: "%b %d, %Y" },
  { label: "30 July 2026", format: "%d %B %Y" }
];

/** Date/datetime source-format picker: common presets, or a custom strptime pattern.
 * customMode is separate local state (not derived from `value`) so the dropdown doesn't
 * snap back to "ISO" while the user is mid-way through typing a custom format that
 * happens not to match any preset yet (e.g. still empty, or partially typed). */
function DateFormatPicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const preset = DATE_FORMATS.find((f) => f.format === value);
  const [customMode, setCustomMode] = useState(!!value && !preset);
  return (
    <>
      <Field label="Source format" hint="how the value is currently written; ISO (2026-07-30) needs no format">
        <select
          value={customMode ? "__custom__" : (value ?? "")}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setCustomMode(true);
            } else {
              setCustomMode(false);
              onChange(e.target.value || undefined);
            }
          }}
        >
          <option value="">ISO / already a date</option>
          {DATE_FORMATS.map((f) => <option key={f.format} value={f.format}>{f.label}</option>)}
          <option value="__custom__">Custom format…</option>
        </select>
      </Field>
      {customMode && (
        <div style={{ marginTop: -4, marginBottom: 10 }}>
          <Field label="Custom format (strptime pattern)">
            <input value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder="e.g. %m-%d-%y" />
          </Field>
          <div className="small dim">%Y 4-digit year · %y 2-digit year · %m month · %d day · %H:%M:%S time · %b Jul · %B July</div>
        </div>
      )}
    </>
  );
}

interface FormProps {
  cfg: Cfg;
  set: (patch: Cfg) => void;
  columns: string[];
  columnTypes: Record<string, string>;
  parameters: any[];
  datasets: any[];
}

function Field({ label, children, hint }: { label: string; children: any; hint?: string }) {
  return (
    <label className="field">
      <span>{label}{hint ? <span className="dim"> — {hint}</span> : null}</span>
      {children}
    </label>
  );
}

/** Provider selection for AI nodes. Cloud providers are never used implicitly
 * (project.md §8.5) — leaving this on "Default" only ever resolves to a local provider. */
export function ProviderPicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const [providers, setProviders] = useState<any[]>([]);
  useEffect(() => {
    api.get<any[]>("/api/llm/providers").then(setProviders).catch(() => {});
  }, []);
  const selected = providers.find((p) => p.id === value);
  return (
    <Field label="Provider" hint="Default only uses local providers; pick a cloud provider explicitly">
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Default (local)</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>{p.displayName}{p.kind === "cloud" ? " — cloud" : ""}</option>
        ))}
      </select>
      {selected?.kind === "cloud" && (
        <div className="small" style={{ color: "var(--amber)" }}>
          {selected.warning ?? "Cloud provider: prompts leave this machine."}
        </div>
      )}
    </Field>
  );
}

function ColumnInput({ value, onChange, columns, placeholder }: { value: string; onChange: (v: string) => void; columns: string[]; placeholder?: string }) {
  if (columns.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder ?? "— choose column —"}</option>
        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        {value && !columns.includes(value) && <option value={value}>{value} (not in input)</option>}
      </select>
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "Column name"} />;
}

export function ExpressionInput({
  value,
  onChange,
  columnTypes,
  parameters,
  placeholder
}: {
  value: string;
  onChange: (v: string) => void;
  columnTypes: Record<string, string>;
  parameters: any[];
  placeholder?: string;
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState("");
  const [aiProviderId, setAiProviderId] = useState<string | undefined>(undefined);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const validation = useMemo(() => {
    if (!value.trim()) return null;
    try {
      return validateExpression(value, { columns: columnTypes as never, parameters });
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }
  }, [value, columnTypes, parameters]);

  return (
    <div>
      <textarea
        className="mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'e.g. {Amount in USD} > {param!threshold} and is_null({Receipt ID})'}
        rows={2}
        style={{ width: "100%" }}
      />
      {validation && !validation.ok && Object.keys(columnTypes).length > 0 && (
        <div className="small" style={{ color: "var(--red)", marginTop: 2 }}>{validation.errors.join(" ")}</div>
      )}
      {validation && validation.ok && (
        <div className="small" style={{ color: "var(--green)", marginTop: 2 }}>Expression is valid.</div>
      )}
      <div className="small dim" style={{ marginTop: 2 }}>
        Syntax: {"{Column}"}, {"{param!key}"}, and, or, not, contains, is_null(), days_between(), date("YYYY-MM-DD")
        {" · "}
        <button className="ghost small" type="button" onClick={() => setAiOpen(!aiOpen)}>AI assist</button>
      </div>
      {aiOpen && (
        <div className="card" style={{ marginTop: 6 }}>
          <Field label="Describe the rule" hint="schema only, no data rows are sent">
            <input value={aiRequest} onChange={(e) => setAiRequest(e.target.value)} placeholder="e.g. flag expenses over the receipt threshold with no receipt" />
          </Field>
          <ProviderPicker value={aiProviderId} onChange={setAiProviderId} />
          <button
            className="small"
            disabled={aiBusy || !aiRequest.trim()}
            onClick={async () => {
              setAiBusy(true);
              setAiResult(null);
              try {
                const r = await api.post<any>("/api/llm/suggest-expression", {
                  request: aiRequest,
                  columns: columnTypes,
                  parameters,
                  providerId: aiProviderId
                });
                setAiResult(r);
              } catch (e: any) {
                setAiResult({ error: e.message });
              } finally {
                setAiBusy(false);
              }
            }}
          >
            {aiBusy ? "Asking…" : "Suggest expression"}
          </button>
          {aiResult?.error && <div className="error-box">{aiResult.error}</div>}
          {aiResult?.expression && (
            <div style={{ marginTop: 8 }}>
              <code className="mono">{aiResult.expression}</code>
              <div className="small dim">{aiResult.explanation}</div>
              {!aiResult.valid && <div className="small" style={{ color: "var(--red)" }}>Suggestion failed validation: {aiResult.validationErrors?.join(" ")}</div>}
              <button className="small primary" style={{ marginTop: 4 }} disabled={!aiResult.valid} onClick={() => { onChange(aiResult.expression); setAiOpen(false); }}>
                Use this expression
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ListEditor<T>({ items, onChange, render, makeNew, addLabel }: {
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, update: (patch: Partial<T>) => void, remove: () => void, index: number) => any;
  makeNew: () => T;
  addLabel: string;
}) {
  return (
    <div>
      {items.map((item, i) => (
        <div className="card" key={i} style={{ padding: "10px 12px" }}>
          {render(
            item,
            (patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it))),
            () => onChange(items.filter((_, j) => j !== i)),
            i
          )}
        </div>
      ))}
      <button className="small" type="button" onClick={() => onChange([...items, makeNew()])}>+ {addLabel}</button>
    </div>
  );
}

function MultiColumnEditor({ value, onChange, columns, label }: { value: string[]; onChange: (v: string[]) => void; columns: string[]; label: string }) {
  return (
    <Field label={label}>
      <div>
        {value.map((c, i) => (
          <div className="row" key={i} style={{ marginBottom: 4 }}>
            <ColumnInput value={c} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} columns={columns} />
            <button className="small ghost" style={{ flex: "0 0 auto" }} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="small" type="button" onClick={() => onChange([...value, ""])}>+ add column</button>
      </div>
    </Field>
  );
}

function NodeForm(props: FormProps & { nodeType: string }) {
  const { nodeType, cfg, set, columns, columnTypes, parameters, datasets } = props;
  const exprProps = { columnTypes, parameters };

  switch (nodeType) {
    case "import_file": {
      const datasetParams = parameters.filter((p) => p.type === "dataset");
      return (
        <>
          <Field label="Bind to" hint="dataset parameters keep workflows reusable across audits">
            <select
              value={cfg.datasetParameterKey ? `param:${cfg.datasetParameterKey}` : cfg.datasetVersionId ? `dsv:${cfg.datasetVersionId}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("param:")) set({ datasetParameterKey: v.slice(6), datasetVersionId: undefined });
                else if (v.startsWith("dsv:")) set({ datasetVersionId: v.slice(4), datasetParameterKey: undefined });
                else set({ datasetVersionId: undefined, datasetParameterKey: undefined });
              }}
            >
              <option value="">— choose —</option>
              <optgroup label="Dataset parameters (chosen at run time)">
                {datasetParams.map((p) => <option key={p.key} value={`param:${p.key}`}>{p.label} ({p.key})</option>)}
              </optgroup>
              <optgroup label="Fixed datasets">
                {datasets.filter((d) => d.latestVersion).map((d) => (
                  <option key={d.id} value={`dsv:${d.latestVersion.id}`}>{d.name} ({d.latestVersion.rowCount} rows)</option>
                ))}
              </optgroup>
            </select>
          </Field>
          {datasetParams.length === 0 && <div className="small dim">Tip: add a parameter of type “dataset” in the Parameters panel to make this input selectable at run time.</div>}
        </>
      );
    }
    case "import_sample":
      return (
        <Field label="Sample dataset">
          <select value={cfg.sampleId ?? ""} onChange={(e) => set({ sampleId: e.target.value })}>
            <option value="">— choose —</option>
            {datasets.filter((d) => d.kind === "sample").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      );
    case "import_api":
      return (
        <>
          <div className="warn-box">This node needs Internet access and will fail when offline. Localhost and private addresses are blocked.</div>
          <Field label="URL"><input value={cfg.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com/records" /></Field>
          <Field label="Method">
            <select value={cfg.method ?? "GET"} onChange={(e) => set({ method: e.target.value })}>
              <option>GET</option><option>POST</option>
            </select>
          </Field>
          <Field label="Records path" hint="optional dot-path to the array, e.g. data.items">
            <input value={cfg.recordsPath ?? ""} onChange={(e) => set({ recordsPath: e.target.value })} />
          </Field>
        </>
      );
    case "filter":
      return (
        <>
          <Field label="Keep rows where">
            <ExpressionInput value={cfg.expression ?? ""} onChange={(v) => set({ expression: v })} {...exprProps} />
          </Field>
          <Field label="Row limit (optional)">
            <input type="number" value={cfg.limit ?? ""} onChange={(e) => set({ limit: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <Field label="Also output non-matching rows">
            <select value={String(cfg.emitNonMatching ?? false)} onChange={(e) => set({ emitNonMatching: e.target.value === "true" })}>
              <option value="false">No</option><option value="true">Yes (unmatched output)</option>
            </select>
          </Field>
        </>
      );
    case "validate":
      return (
        <>
          <ListEditor
            items={cfg.rules ?? []}
            onChange={(rules) => set({ rules })}
            addLabel="add validation rule"
            makeNew={() => ({ name: "", condition: "", severity: "medium" })}
            render={(rule: any, update, remove) => (
              <>
                <div className="row">
                  <Field label="Rule name"><input value={rule.name} onChange={(e) => update({ name: e.target.value })} /></Field>
                  <Field label="Severity">
                    <select value={rule.severity} onChange={(e) => update({ severity: e.target.value })}>
                      <option>low</option><option>medium</option><option>high</option>
                    </select>
                  </Field>
                  <button className="small ghost" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={remove}>✕</button>
                </div>
                <Field label="Exception when" hint="rows matching this condition are exceptions">
                  <ExpressionInput value={rule.condition} onChange={(v) => update({ condition: v })} {...exprProps} />
                </Field>
              </>
            )}
          />
        </>
      );
    case "join":
      return (
        <>
          <Field label="Join type">
            <select value={cfg.joinType ?? "inner"} onChange={(e) => set({ joinType: e.target.value })}>
              <option value="inner">Inner — only matches</option>
              <option value="left">Left — keep all left rows</option>
              <option value="full">Full outer — keep everything</option>
            </select>
          </Field>
          <ListEditor
            items={cfg.keys ?? []}
            onChange={(keys) => set({ keys })}
            addLabel="add key pair"
            makeNew={() => ({ left: "", right: "" })}
            render={(k: any, update, remove) => (
              <div className="row">
                <Field label="Left key"><ColumnInput value={k.left} onChange={(v) => update({ left: v })} columns={columns} /></Field>
                <Field label="Right key"><input value={k.right} onChange={(e) => update({ right: e.target.value })} placeholder="Right column" /></Field>
                <button className="small ghost" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={remove}>✕</button>
              </div>
            )}
          />
          <Field label="Right-side suffix on name collision"><input value={cfg.rightSuffix ?? "_right"} onChange={(e) => set({ rightSuffix: e.target.value })} /></Field>
        </>
      );
    case "append":
      return (
        <Field label="Align columns by name" hint="recommended when input schemas differ in order">
          <select value={String(cfg.alignByName ?? true)} onChange={(e) => set({ alignByName: e.target.value === "true" })}>
            <option value="true">Yes</option><option value="false">No — positional</option>
          </select>
        </Field>
      );
    case "deduplicate":
      return (
        <>
          <MultiColumnEditor value={cfg.keys ?? []} onChange={(keys) => set({ keys })} columns={columns} label="Key columns (rows equal on these are duplicates)" />
          <Field label="Keep">
            <select value={cfg.keep ?? "first"} onChange={(e) => set({ keep: e.target.value })}>
              <option value="first">First occurrence</option>
              <option value="last">Last occurrence</option>
              <option value="sort">Best by sort column</option>
            </select>
          </Field>
          {cfg.keep === "sort" && (
            <div className="row">
              <Field label="Sort column"><ColumnInput value={cfg.sortColumn ?? ""} onChange={(v) => set({ sortColumn: v })} columns={columns} /></Field>
              <Field label="Direction">
                <select value={cfg.sortDirection ?? "asc"} onChange={(e) => set({ sortDirection: e.target.value })}>
                  <option value="asc">Ascending</option><option value="desc">Descending</option>
                </select>
              </Field>
            </div>
          )}
        </>
      );
    case "add_columns":
    case "overwrite_columns":
      return (
        <ListEditor
          items={cfg.columns ?? []}
          onChange={(cols) => set({ columns: cols })}
          addLabel="add column"
          makeNew={() => ({ name: "", expression: "" })}
          render={(col: any, update, remove) => (
            <>
              <div className="row">
                <Field label={nodeType === "add_columns" ? "New column name" : "Column to overwrite"}>
                  {nodeType === "overwrite_columns"
                    ? <ColumnInput value={col.name} onChange={(v) => update({ name: v })} columns={columns} />
                    : <input value={col.name} onChange={(e) => update({ name: e.target.value })} />}
                </Field>
                <button className="small ghost" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={remove}>✕</button>
              </div>
              <Field label="Expression">
                <ExpressionInput value={col.expression} onChange={(v) => update({ expression: v })} {...exprProps} />
              </Field>
            </>
          )}
        />
      );
    case "edit_columns":
      return (
        <ListEditor
          items={cfg.edits ?? []}
          onChange={(edits) => set({ edits })}
          addLabel="add edit"
          makeNew={() => ({ column: "", rename: undefined, newType: undefined, sourceFormat: undefined } as { column: string; rename?: string; newType?: string; sourceFormat?: string })}
          render={(e2: any, update, remove) => (
            <>
              <div className="row">
                <Field label={`Column${e2.column && columnTypes[e2.column] ? ` (currently: ${columnTypes[e2.column]})` : ""}`}>
                  <ColumnInput value={e2.column} onChange={(v) => update({ column: v })} columns={columns} />
                </Field>
                <Field label="Rename to (optional)"><input value={e2.rename ?? ""} onChange={(ev) => update({ rename: ev.target.value || undefined })} /></Field>
                <Field label="New type (optional)">
                  <select value={e2.newType ?? ""} onChange={(ev) => update({ newType: ev.target.value || undefined, sourceFormat: undefined })}>
                    <option value="">keep</option>
                    {["text", "integer", "decimal", "boolean", "date", "datetime"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <button className="small ghost" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={remove}>✕</button>
              </div>
              {(e2.newType === "date" || e2.newType === "datetime") && (
                <DateFormatPicker value={e2.sourceFormat} onChange={(sourceFormat) => update({ sourceFormat })} />
              )}
            </>
          )}
        />
      );
    case "select_columns":
      return <MultiColumnEditor value={cfg.columns ?? []} onChange={(v) => set({ columns: v })} columns={columns} label="Columns to keep (in order)" />;
    case "sort":
      return (
        <ListEditor
          items={cfg.keys ?? []}
          onChange={(keys) => set({ keys })}
          addLabel="add sort key"
          makeNew={() => ({ column: "", direction: "asc" })}
          render={(k: any, update, remove) => (
            <div className="row">
              <Field label="Column"><ColumnInput value={k.column} onChange={(v) => update({ column: v })} columns={columns} /></Field>
              <Field label="Direction">
                <select value={k.direction} onChange={(e) => update({ direction: e.target.value })}>
                  <option value="asc">Ascending</option><option value="desc">Descending</option>
                </select>
              </Field>
              <button className="small ghost" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={remove}>✕</button>
            </div>
          )}
        />
      );
    case "sample":
      return (
        <div className="row">
          <Field label="Mode">
            <select value={cfg.mode ?? "first"} onChange={(e) => set({ mode: e.target.value })}>
              <option value="first">First N rows</option>
              <option value="random">Random sample (repeatable)</option>
            </select>
          </Field>
          <Field label="Rows"><input type="number" value={cfg.rows ?? ""} onChange={(e) => set({ rows: Number(e.target.value) })} /></Field>
        </div>
      );
    case "find_replace":
      return (
        <>
          <Field label="Column"><ColumnInput value={cfg.column ?? ""} onChange={(v) => set({ column: v })} columns={columns} /></Field>
          <div className="row">
            <Field label="Find"><input value={cfg.find ?? ""} onChange={(e) => set({ find: e.target.value })} /></Field>
            <Field label="Replace with"><input value={cfg.replace ?? ""} onChange={(e) => set({ replace: e.target.value })} /></Field>
          </div>
          <Field label="Match case">
            <select value={String(cfg.matchCase ?? false)} onChange={(e) => set({ matchCase: e.target.value === "true" })}>
              <option value="false">No</option><option value="true">Yes</option>
            </select>
          </Field>
        </>
      );
    case "text_to_columns":
      return (
        <>
          <Field label="Column to split"><ColumnInput value={cfg.column ?? ""} onChange={(v) => set({ column: v })} columns={columns} /></Field>
          <Field label="Delimiter"><input value={cfg.delimiter ?? ""} onChange={(e) => set({ delimiter: e.target.value })} placeholder="e.g. , or - " /></Field>
          <MultiColumnEditor value={cfg.newColumns ?? []} onChange={(v) => set({ newColumns: v })} columns={[]} label="New column names" />
        </>
      );
    case "parse_json":
      return (
        <>
          <Field label="JSON column"><ColumnInput value={cfg.column ?? ""} onChange={(v) => set({ column: v })} columns={columns} /></Field>
          <ListEditor
            items={cfg.fields ?? []}
            onChange={(fields) => set({ fields })}
            addLabel="add field"
            makeNew={() => ({ path: "", name: "" })}
            render={(f: any, update, remove) => (
              <div className="row">
                <Field label="JSON path" hint="e.g. address.city"><input value={f.path} onChange={(e) => update({ path: e.target.value })} /></Field>
                <Field label="New column"><input value={f.name} onChange={(e) => update({ name: e.target.value })} /></Field>
                <button className="small ghost" style={{ flex: "0 0 auto", alignSelf: "center" }} onClick={remove}>✕</button>
              </div>
            )}
          />
        </>
      );
    case "pivot":
      return (
        <>
          <MultiColumnEditor value={cfg.groupBy ?? []} onChange={(v) => set({ groupBy: v })} columns={columns} label="Group by" />
          <div className="row">
            <Field label="Pivot column"><ColumnInput value={cfg.pivotColumn ?? ""} onChange={(v) => set({ pivotColumn: v })} columns={columns} /></Field>
            <Field label="Value column"><ColumnInput value={cfg.valueColumn ?? ""} onChange={(v) => set({ valueColumn: v })} columns={columns} /></Field>
          </div>
          <Field label="Aggregate">
            <select value={cfg.aggregate ?? "sum"} onChange={(e) => set({ aggregate: e.target.value })}>
              {["sum", "count", "min", "max", "avg"].map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
        </>
      );
    case "unpivot":
      return (
        <>
          <MultiColumnEditor value={cfg.idColumns ?? []} onChange={(v) => set({ idColumns: v })} columns={columns} label="ID columns (kept as-is)" />
          <MultiColumnEditor value={cfg.valueColumns ?? []} onChange={(v) => set({ valueColumns: v })} columns={columns} label="Columns to unpivot" />
          <div className="row">
            <Field label="Name column"><input value={cfg.nameTo ?? "name"} onChange={(e) => set({ nameTo: e.target.value })} /></Field>
            <Field label="Value column"><input value={cfg.valueTo ?? "value"} onChange={(e) => set({ valueTo: e.target.value })} /></Field>
          </div>
        </>
      );
    case "python":
      return (
        <>
          <div className="warn-box">Python runs in an isolated process. The input table is available as <code>rows</code> (a list of dicts). Leave the transformed list in <code>rows</code>.</div>
          <Field label="Code">
            <textarea className="mono" rows={10} value={cfg.code ?? ""} onChange={(e) => set({ code: e.target.value })}
              placeholder={'# example:\nrows = [r for r in rows if float(r["Amount"] or 0) > 100]'} />
          </Field>
          <Field label="Timeout (ms)"><input type="number" value={cfg.timeoutMs ?? 60000} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} /></Field>
        </>
      );
    case "chart":
      return (
        <>
          <div className="row">
            <Field label="Chart type">
              <select value={cfg.chartType ?? "bar"} onChange={(e) => set({ chartType: e.target.value })}>
                <option>bar</option><option>line</option><option>pie</option>
              </select>
            </Field>
            <Field label="Aggregate">
              <select value={cfg.aggregate ?? "sum"} onChange={(e) => set({ aggregate: e.target.value })}>
                {["sum", "count", "min", "max", "avg"].map((a) => <option key={a}>{a}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Dimension"><ColumnInput value={cfg.dimension ?? ""} onChange={(v) => set({ dimension: v })} columns={columns} /></Field>
            <Field label="Measure"><ColumnInput value={cfg.measure ?? ""} onChange={(v) => set({ measure: v })} columns={columns} /></Field>
          </div>
        </>
      );
    case "publish_toolkit":
      return (
        <div className="info-box">
          Marks this branch's output as the toolkit deliverable. Actual publishing happens from the Versions tab once this version is verified (only verified versions can be published).
        </div>
      );
    case "llm_chat":
      return (
        <>
          <Field label="Prompt"><textarea value={cfg.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} /></Field>
          <Field label="Share input schema with the model" hint="column names and types only — never data rows">
            <select value={String(cfg.includeSchema ?? false)} onChange={(e) => set({ includeSchema: e.target.value === "true" })}>
              <option value="false">No</option><option value="true">Yes</option>
            </select>
          </Field>
          <ProviderPicker value={cfg.providerId} onChange={(providerId) => set({ providerId })} />
        </>
      );
    case "explain_expression":
      return (
        <>
          <Field label="Expression to explain">
            <textarea className="mono" value={cfg.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />
          </Field>
          <ProviderPicker value={cfg.providerId} onChange={(providerId) => set({ providerId })} />
        </>
      );
    case "generate_test_logic":
      return (
        <>
          <Field label="Audit objective" hint="AI output is a draft for review — it never runs unreviewed">
            <textarea value={cfg.objective ?? ""} onChange={(e) => set({ objective: e.target.value })} />
          </Field>
          <ProviderPicker value={cfg.providerId} onChange={(providerId) => set({ providerId })} />
        </>
      );
    case "new_table":
    default:
      return (
        <Field label="Configuration (JSON)">
          <JsonEditor value={cfg} onChange={set} />
        </Field>
      );
  }
}

function JsonEditor({ value, onChange }: { value: Cfg; onChange: (v: Cfg) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(value ?? {}, null, 2)), [value]);
  return (
    <div>
      <textarea
        className="mono"
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr(null);
          } catch {
            setErr("Invalid JSON — changes not applied yet.");
          }
        }}
      />
      {err && <div className="small" style={{ color: "var(--amber)" }}>{err}</div>}
    </div>
  );
}

export function NodeConfigPanel({
  node,
  upstreamColumns,
  parameters,
  datasets,
  onSave,
  onDelete,
  readOnly
}: {
  node: { id: string; type: string; label?: string; config: Cfg };
  upstreamColumns: Record<string, string>;
  parameters: any[];
  datasets: any[];
  onSave: (patch: { label?: string; config: Cfg }) => void;
  onDelete: () => void;
  readOnly: boolean;
}) {
  const def = getNodeType(node.type);
  const [label, setLabel] = useState(node.label ?? def?.label ?? node.type);
  const [cfg, setCfg] = useState<Cfg>(node.config ?? {});
  useEffect(() => {
    setLabel(node.label ?? def?.label ?? node.type);
    setCfg(node.config ?? {});
  }, [node.id]);

  const validation = useMemo(() => validateNodeConfig(node.type, cfg), [node.type, cfg]);
  const columns = Object.keys(upstreamColumns);

  if (!def) return <div className="error-box">Unknown node type: {node.type}</div>;

  return (
    <div>
      <h3>{def.label}</h3>
      <p className="small dim" style={{ marginTop: -6 }}>{def.description}</p>
      {def.requiresNetwork && <div className="chip">requires Internet</div>}
      {def.customCode && <div className="chip">isolated process</div>}
      <Field label="Node name">
        <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={readOnly} />
      </Field>
      {columns.length > 0 && (
        <div className="small dim" style={{ marginBottom: 8 }}>
          Input columns: {columns.slice(0, 8).join(", ")}{columns.length > 8 ? "…" : ""}
        </div>
      )}
      <fieldset disabled={readOnly} style={{ border: "none", padding: 0, margin: 0 }}>
        <NodeForm nodeType={node.type} cfg={cfg} set={(patch) => setCfg({ ...cfg, ...patch })} columns={columns} columnTypes={upstreamColumns} parameters={parameters} datasets={datasets} />
      </fieldset>
      {!validation.ok && <div className="error-box">{validation.errors.join("\n")}</div>}
      {!readOnly && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!validation.ok} onClick={() => onSave({ label, config: cfg })}>Save node</button>
          <button className="danger" style={{ flex: "0 0 auto" }} onClick={onDelete}>Delete node</button>
        </div>
      )}
      {readOnly && <div className="info-box">This version is read-only. Create a new draft to edit.</div>}
    </div>
  );
}
