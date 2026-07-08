/** In-app user guide: navigation, workflow lifecycle, node reference (generated
 * from the node registry so it never drifts), and expression samples. */
import { useEffect, useState, type ReactNode } from "react";
import { NODE_TYPES } from "@traceforge/domain";

function Code({ children }: { children: ReactNode }) {
  return <code className="mono guide-code">{children}</code>;
}

function ExprBlock({ items }: { items: { expr: string; note: string }[] }) {
  return (
    <table className="grid" style={{ margin: "8px 0" }}>
      <thead><tr><th>Expression</th><th>What it does</th></tr></thead>
      <tbody>
        {items.map((i, idx) => (
          <tr key={idx}>
            <td className="mono guide-expr">{i.expr}</td>
            <td className="small">{i.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Curated notes + sample expressions per node type, merged into the generated reference. */
const NODE_NOTES: Record<string, { usesExpressions?: boolean; how: ReactNode; samples?: { expr: string; note: string }[] }> = {
  import_file: {
    how: <>Bind it to a <b>dataset parameter</b> (recommended — the runner picks the file at run time) or to a fixed imported dataset. Import files on the <b>Datasets</b> page first; every import is fingerprinted with SHA-256 for evidence.</>
  },
  import_sample: {
    how: <>Pick one of the built-in offline sample datasets (expenses, employee master, payroll register, vendor invoices, user access). Ideal for trying templates before using real data.</>
  },
  import_api: {
    how: <>Fetches JSON records from an HTTP API. Needs Internet; localhost and private-network addresses are blocked for security. Use <b>Records path</b> (e.g. <Code>data.items</Code>) when the array is nested.</>
  },
  new_table: {
    how: <>Define a small table by hand — handy for lookup lists like approved vendors or department codes.</>
  },
  filter: {
    usesExpressions: true,
    how: <>Keeps rows where the expression is true (the <b>matched</b> output). Enable <b>non-matching rows</b> to also route the rest to an <b>unmatched</b> output — useful for &ldquo;population vs exceptions&rdquo; splits.</>,
    samples: [
      { expr: '{Amount in USD} > {param!receipt_threshold}', note: "Rows above a threshold parameter." },
      { expr: '{Status} = "Terminated"', note: "Exact text match (case-sensitive)." },
      { expr: 'is_null({Receipt ID}) and {Amount in USD} > 75', note: "Missing receipt on a material amount." },
      { expr: '{Department} in ("Finance", "Treasury")', note: "Membership in a list." },
      { expr: 'days_between({Invoice Date}, {Posting Date}) > 30', note: "Posted more than 30 days after the invoice date." },
      { expr: 'contains(lower({Description}), "gift")', note: "Case-insensitive keyword search." },
      { expr: 'not_null({Termination Date}) and {Last Login} > {Termination Date}', note: "Activity after termination." }
    ]
  },
  validate: {
    usesExpressions: true,
    how: <>The audit workhorse. Each rule has a name, a severity, and a condition — rows where the condition is <b>true</b> are exceptions. Outputs: <b>exceptions</b> (one row per violation, tagged with rule name and severity) and <b>summary</b> (exception counts per rule over the rows tested).</>,
    samples: [
      { expr: 'is_null({Receipt ID}) and {Amount in USD} > {param!receipt_threshold}', note: "Missing receipt over the receipt threshold." },
      { expr: 'days_between({Date Expense Incurred}, {Approval Date}) > {param!timeliness_threshold}', note: "Approval outside the timeliness window." },
      { expr: '{Approver ID} = {Employee ID}', note: "Self-approved transaction." },
      { expr: 'contains(lower({Description}), lower({param!prohibited_keyword}))', note: "Prohibited keyword (parameter-driven, case-insensitive)." },
      { expr: '{Amount} < 0', note: "Negative amounts that should not exist." },
      { expr: '{Invoice Date} > date("2026-12-31") or {Invoice Date} < {param!period_start}', note: "Date outside the review period." },
      { expr: 'is_null({Status})', note: "No matching master record after a left join (orphan record)." },
      { expr: 'length(trim({Vendor Name})) = 0', note: "Blank vendor name." }
    ]
  },
  add_columns: {
    usesExpressions: true,
    how: <>Adds calculated columns; existing columns cannot be overwritten here (use Overwrite Columns for that). Each new column has a name and an expression.</>,
    samples: [
      { expr: 'days_between({Date Expense Incurred}, {Approval Date})', note: "New “Days to Approve” column." },
      { expr: '{Quantity} * {Unit Price}', note: "Computed line total." },
      { expr: 'coalesce({Preferred Name}, {Employee Name})', note: "First non-null of two columns." },
      { expr: 'round({Amount} * 0.12, 2)', note: "12% VAT, rounded to centavos." },
      { expr: 'upper(trim({Cost Center}))', note: "Normalized key for joining." },
      { expr: '{Amount in USD} > {param!receipt_threshold}', note: "Boolean flag column (true/false)." }
    ]
  },
  overwrite_columns: {
    usesExpressions: true,
    how: <>Replaces the values of existing columns using expressions. The column keeps its position.</>,
    samples: [
      { expr: 'trim({Vendor Name})', note: "Strip stray whitespace in place." },
      { expr: 'upper({Currency})', note: "Uppercase a code column." },
      { expr: 'coalesce({Region}, "UNASSIGNED")', note: "Fill nulls with a default." },
      { expr: 'round({Amount}, 2)', note: "Normalize decimals." }
    ]
  },
  edit_columns: {
    how: <>Rename columns and convert types. Text → date/datetime conversions accept a source format preset (e.g. <Code>YYYYMMDD</Code>, <Code>MM/DD/YYYY</Code>) or a custom strptime pattern like <Code>%Y%m%d</Code>. Conversions that fail produce null rather than stopping the run — add a Validate rule like <Code>is_null({"{My Date}"})</Code> downstream to catch them.</>
  },
  select_columns: { how: <>Choose which columns to keep and their order. Everything else is dropped.</> },
  sort: { how: <>Order rows by one or more keys. Sorting is deterministic, which keeps evidence hashes stable.</> },
  deduplicate: {
    how: <>Rows sharing the same values in the <b>key columns</b> are duplicates. Choose which to keep (first, last, or best-by-sort-column). Outputs: <b>unique</b> (kept rows) and <b>duplicates</b> (the removed extras — often the audit finding itself, e.g. duplicate payments).</>
  },
  join: {
    how: <>Combines two datasets on key pairs. <b>Inner</b> keeps matches only; <b>left</b> keeps every left row (unmatched right columns become null — filter on <Code>is_null(...)</Code> afterwards to find orphans); <b>full</b> keeps everything. Right-side columns that collide with left names get a suffix.</>
  },
  append: { how: <>Stacks rows from two or more inputs. <b>Align by name</b> matches columns by header (recommended when column order differs).</> },
  find_replace: { how: <>Find/replace text in one column, optionally case-sensitive. No expression needed — plain text in, plain text out.</> },
  text_to_columns: { how: <>Splits one text column by a delimiter into new named columns — e.g. split <Code>Hotel - conference</Code> on <Code>&nbsp;-&nbsp;</Code> into category and detail.</> },
  parse_json: { how: <>Extracts fields from a JSON text column using dot paths like <Code>address.city</Code>.</> },
  sample: { how: <>Take the first N rows or a repeatable random sample (fixed seed, so reruns match — important for evidence).</> },
  pivot: { how: <>Turns values of one column into new columns, aggregating a value column (sum/count/min/max/avg) grouped by your chosen keys.</> },
  unpivot: { how: <>The reverse: melts several columns into name/value rows — useful for normalizing wide spreadsheets.</> },
  python: {
    how: <>For logic the built-in nodes can't express. Your code runs in an <b>isolated process</b>, receives the input table as <Code>rows</Code> (a list of dicts), and must leave the transformed list in <Code>rows</Code>. Example: <Code>rows = [r for r in rows if float(r["Amount"] or 0) &gt; 100]</Code></>
  },
  chart: { how: <>Aggregates a measure by a dimension and outputs the summarized table (rendered as a table in this release).</> },
  publish_toolkit: { how: <>Marks a branch's output as the toolkit deliverable. Actual publishing happens from the <b>Versions</b> tab once the version is verified.</> },
  llm_chat: { how: <>Ask the configured LLM a question mid-workflow. Optionally share the input's <i>schema</i> (column names/types only — never rows). Output is a one-row table with the response.</> },
  explain_expression: { how: <>Asks the LLM to explain an expression in plain language — useful for documenting inherited workflows.</> },
  generate_test_logic: { how: <>Drafts audit test logic from an objective. Treat the output as an untrusted draft: review it, then build the real nodes yourself or via the AI workflow draft.</> }
};

const FUNCTIONS: { sig: string; note: string }[] = [
  { sig: "is_null(x)", note: "True when x is null/blank." },
  { sig: "not_null(x)", note: "True when x has a value." },
  { sig: "lower(text) / upper(text)", note: "Change case." },
  { sig: "trim(text)", note: "Remove surrounding whitespace." },
  { sig: "contains(text, search)", note: "True when text contains search (case-sensitive; wrap both in lower() for case-insensitive)." },
  { sig: "days_between(d1, d2)", note: "Whole days from d1 to d2 (positive when d2 is later)." },
  { sig: 'date("2026-01-31")', note: "Date literal / convert text to a date." },
  { sig: "coalesce(a, b)", note: "First non-null of a and b." },
  { sig: "abs(n)", note: "Absolute value." },
  { sig: "round(n, places)", note: "Round to a number of decimal places." },
  { sig: "length(text)", note: "Number of characters." }
];

const SECTIONS: { id: string; title: string }[] = [
  { id: "quick-start", title: "Quick start" },
  { id: "navigation", title: "Navigating the app" },
  { id: "lifecycle", title: "Workflows & versions" },
  { id: "canvas", title: "Building on the canvas" },
  { id: "parameters", title: "Parameters" },
  { id: "expressions", title: "Expression language" },
  { id: "nodes", title: "Node reference" },
  { id: "running", title: "Running & previews" },
  { id: "history", title: "Run history & evidence" },
  { id: "verification", title: "Verification & activation" },
  { id: "publish", title: "Publish to toolkit" },
  { id: "ai", title: "AI assist & privacy" },
  { id: "troubleshooting", title: "Troubleshooting" }
];

export function GuidePage() {
  const [active, setActive] = useState("quick-start");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { setActive(e.target.id); break; }
      },
      { rootMargin: "0px 0px -75% 0px" }
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="page wide guide-layout">
      <aside className="guide-toc">
        <h3>User Guide</h3>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`navlink ${active === s.id ? "active" : ""}`} onClick={() => jump(s.id)}>
            {s.title}
          </button>
        ))}
      </aside>

      <div className="guide-body">
        <h1>TraceForge User Guide</h1>
        <p className="sub">Build, run, verify, and reuse audit analytics workflows — entirely on this machine.</p>

        <section id="quick-start">
          <h2>Quick start</h2>
          <ol className="guide-steps">
            <li><b>Import your data.</b> Go to <b>Datasets → Import file</b> (CSV, Excel, JSON, or Parquet). Every import is snapshotted and SHA-256 fingerprinted. Or skip this — five sample datasets ship built in.</li>
            <li><b>Clone a template.</b> Open <b>Templates</b>, preview one (e.g. Travel &amp; Expense Testing), and clone it. You get an editable <b>draft</b> workflow with the canvas, parameters, and validation rules ready.</li>
            <li><b>Run it.</b> On the canvas click <b>▶ Run</b>, pick datasets for the dataset parameters, adjust thresholds, and run. Node borders turn green as they finish.</li>
            <li><b>Inspect results.</b> Select a node and use <b>Preview</b> to see its output tables. The Validate node's <i>exceptions</i> output is your findings list; export it to CSV/Excel.</li>
            <li><b>Make it official.</b> Versions tab → <b>Submit for review</b>, record tester/reviewer, run a sample, <b>Pass</b> → <b>Activate</b> → <b>Publish to toolkit</b>.</li>
          </ol>
        </section>

        <section id="navigation">
          <h2>Navigating the app</h2>
          <dl className="kv">
            <dt>Workflows</dt><dd>The catalog: every audit workflow with its verification status, active version, publisher, and last update. Search, filter, sort, choose visible columns, duplicate, or archive from here.</dd>
            <dt>Templates</dt><dd>Built-in audit templates plus tools your team published. Cloning creates a new draft workflow; templates themselves never change.</dd>
            <dt>Datasets</dt><dd>Imported files, manual tables, samples, and node outputs — each with row counts, schema, source fingerprint, preview, column profiling, and CSV/Excel export.</dd>
            <dt>Toolkit</dt><dd>Approved tools: verified workflow versions published for reuse. Clone one to a new draft, open its source, or unpublish (the source workflow is preserved).</dd>
            <dt>Settings</dt><dd>Your local profile name (recorded on runs, reviews, publishes) and LLM providers. Ollama (local) is the default; cloud providers are opt-in per action.</dd>
            <dt>Guide</dt><dd>This page.</dd>
          </dl>
          <p className="small dim">Tips: the sidebar auto-collapses in the workflow editor (« / » to toggle). The ☀/☾ button switches light/dark theme.</p>
        </section>

        <section id="lifecycle">
          <h2>Workflows &amp; versions</h2>
          <p>A workflow's logic lives in <b>versions</b>. Only drafts are editable — everything that has been reviewed, verified, or run stays frozen so evidence remains reproducible.</p>
          <p style={{ margin: "10px 0" }}>
            <span className="badge draft">draft</span> → <span className="badge in_review">in review</span> → <span className="badge verified">verified</span> → <span className="badge active">active</span> → <span className="badge superseded">superseded</span>
          </p>
          <ul>
            <li><b>Draft</b> — editable. Submit for review when ready.</li>
            <li><b>In review</b> — locked while a tester and reviewer verify it. The reviewer can Pass, Fail, or send it back with an Amend.</li>
            <li><b>Verified</b> — passed review; immutable forever. Can be activated and published.</li>
            <li><b>Active</b> — the one version runners should use. Activating a newer verified version supersedes the old one automatically.</li>
            <li>To change a verified/active workflow, use <b>New draft from this</b> — a new version number is created from its graph.</li>
          </ul>
          <p><b>Deleting:</b> Archive is the default (evidence and run history preserved; toolkit entries unpublished). Permanent delete only works on drafts that were never run, reviewed, or published.</p>
        </section>

        <section id="canvas">
          <h2>Building on the canvas</h2>
          <ul>
            <li><b>Add nodes</b> from the searchable palette (left). Categories: Import, Clean, Merge, Transform, Code, Visualize, Governance, AI. 🌐 marks nodes that need Internet.</li>
            <li><b>Connect</b> by dragging from an output handle (right side, green) to an input handle (left side, blue). Multi-input nodes label their ports (Join: <i>left</i> | <i>right</i>). Invalid connections are blocked with a message.</li>
            <li><b>Configure</b> by selecting a node — the Inspector opens with a form built from the node's schema. Required fields and invalid expressions block saving.</li>
            <li><b>Branch freely.</b> One import can feed many tests (fan-out); Join and Append bring branches back together (fan-in). Cycles are not allowed.</li>
            <li><b>Sticky notes</b> document the audit objective next to the nodes; they're editable, resizable, and saved with the version.</li>
            <li><b>Save / Validate / Run</b> from the toolbar. Validate checks structure, configs, and expressions before you ever run. Delete/Backspace removes selected nodes.</li>
            <li>Zoom/pan with the mouse, use the minimap for large flows, and the controls to fit-to-screen.</li>
          </ul>
        </section>

        <section id="parameters">
          <h2>Parameters</h2>
          <p>Parameters make one workflow reusable across audits — thresholds, dates, keywords, and input files are set at run time instead of hard-coded.</p>
          <ul>
            <li>Types: text, integer, decimal, boolean, date, enum, and <b>dataset</b> (the runner picks an imported file for it).</li>
            <li>Keys are lowercase_with_underscores and are referenced in expressions as <Code>{"{param!key}"}</Code>.</li>
            <li>Defaults pre-fill the Run dialog; required parameters block the run until set.</li>
            <li>Values used in each run are captured in run history and evidence.</li>
            <li>Definitions are editable on drafts only; runtime values can always be changed per run.</li>
          </ul>
        </section>

        <section id="expressions">
          <h2>Expression language</h2>
          <p>Expressions power <b>Filter</b>, <b>Validate</b>, <b>Add Columns</b>, and <b>Overwrite Columns</b>. They compile to safe database operations — no scripting, no host access — and are validated as you type against the input's actual columns.</p>
          <h3>Syntax</h3>
          <table className="grid">
            <tbody>
              <tr><td className="mono guide-expr">{"{Column Name}"}</td><td className="small">Column reference — braces allow spaces. Case-sensitive.</td></tr>
              <tr><td className="mono guide-expr">{"{param!receipt_threshold}"}</td><td className="small">Workflow parameter reference.</td></tr>
              <tr><td className="mono guide-expr">"text"&nbsp;&nbsp;100&nbsp;&nbsp;100.25&nbsp;&nbsp;true&nbsp;&nbsp;null</td><td className="small">Literals. Dates via <Code>date("2026-01-31")</Code>.</td></tr>
              <tr><td className="mono guide-expr">=&nbsp;&nbsp;!=&nbsp;&nbsp;&gt;&nbsp;&nbsp;&gt;=&nbsp;&nbsp;&lt;&nbsp;&nbsp;&lt;=</td><td className="small">Comparisons.</td></tr>
              <tr><td className="mono guide-expr">and&nbsp;&nbsp;or&nbsp;&nbsp;not</td><td className="small">Boolean logic; use parentheses to group.</td></tr>
              <tr><td className="mono guide-expr">+&nbsp;&nbsp;-&nbsp;&nbsp;*&nbsp;&nbsp;/</td><td className="small">Arithmetic on numeric values.</td></tr>
              <tr><td className="mono guide-expr">{'{X} contains "text"'}</td><td className="small">Text search operator.</td></tr>
              <tr><td className="mono guide-expr">{'{X} in ("a", "b")'}</td><td className="small">Membership test.</td></tr>
            </tbody>
          </table>
          <h3>Functions</h3>
          <table className="grid">
            <tbody>
              {FUNCTIONS.map((f) => (
                <tr key={f.sig}><td className="mono guide-expr">{f.sig}</td><td className="small">{f.note}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="info-box" style={{ marginTop: 10 }}>
            Stuck? Every expression field has an <b>AI assist</b> link — describe the rule in plain language and a validated expression is suggested. Only column names and types are shared with the model, never data rows.
          </div>
        </section>

        <section id="nodes">
          <h2>Node reference</h2>
          {["Import", "Clean", "Merge", "Transform", "Code", "Visualize", "Governance", "AI"].map((cat) => (
            <div key={cat}>
              <h3>{cat}</h3>
              {NODE_TYPES.filter((t) => t.category === cat).map((t) => {
                const notes = NODE_NOTES[t.type];
                return (
                  <div className="card" key={t.type}>
                    <h3 style={{ marginBottom: 2 }}>
                      {t.label}{" "}
                      {t.requiresNetwork && <span className="chip">requires Internet</span>}
                      {t.customCode && <span className="chip">isolated process</span>}
                      {notes?.usesExpressions && <span className="chip">uses expressions</span>}
                    </h3>
                    <p className="small dim" style={{ margin: "2px 0 6px" }}>
                      {t.description}
                      {" · "}inputs: {t.inputs.length ? t.inputs.map((p) => p.name).join(", ") : "none"}
                      {" · "}outputs: {t.outputs.length ? t.outputs.map((p) => p.name).join(", ") : "none"}
                    </p>
                    {notes && <p className="small" style={{ margin: "0 0 4px" }}>{notes.how}</p>}
                    {notes?.samples && (
                      <>
                        <div className="small dim" style={{ marginTop: 6 }}>Sample expressions</div>
                        <ExprBlock items={notes.samples} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <section id="running">
          <h2>Running &amp; previews</h2>
          <ul>
            <li><b>▶ Run</b> opens the parameter dialog. Dataset parameters list your imported datasets (and samples) with row counts.</li>
            <li>Node status streams live onto the canvas: <span className="badge running">running</span> <span className="badge succeeded">succeeded</span> <span className="badge failed">failed</span> <span className="badge skipped">skipped</span> (downstream of a failure).</li>
            <li>After a run, select a node and click <b>Preview: &lt;output&gt;</b> — first 100 rows, column types shown, nulls displayed as <Code>null</Code>. <b>Profile columns</b> adds null counts, distinct counts, and min/max.</li>
            <li>Previews are read-only and never modify data; every node output is stored as its own immutable snapshot.</li>
            <li>Cancel a running workflow from the toolbar; the run is recorded as cancelled.</li>
          </ul>
        </section>

        <section id="history">
          <h2>Run history &amp; evidence</h2>
          <ul>
            <li>The <b>Run History</b> tab lists every execution: status, trigger, duration, runner, and the exact parameter values used.</li>
            <li>Open a run to see per-node results, logs, errors, and per-output CSV downloads.</li>
            <li><b>Evidence</b> (Markdown or JSON) bundles the workflow version, parameters, input file fingerprints, output hashes, node results, and LLM usage — with a stable SHA-256 evidence hash. Same run, same bytes, same hash.</li>
            <li><b>Rerun</b> repeats a run with the same version and parameters, linked to the original; it's blocked if the original inputs no longer exist.</li>
            <li>Secrets are redacted from logs and evidence automatically. Run history is retained even when a workflow is archived.</li>
          </ul>
        </section>

        <section id="verification">
          <h2>Verification &amp; activation</h2>
          <ol className="guide-steps">
            <li><b>Submit for review</b> (Versions tab). The workflow must pass structural validation first; the version locks as <span className="badge in_review">in review</span>.</li>
            <li>On the <b>Verification</b> tab, record the <b>tester</b>, <b>reviewer</b>, and the testing performed.</li>
            <li>Click <b>Run sample</b> — a verification run linked to the review. A successful sample run is required to pass.</li>
            <li>The reviewer decides: <b>Pass</b> (→ verified, immutable), <b>Amend</b> (→ back to draft with comments), or <b>Fail</b> (→ rejected).</li>
            <li><b>Activate</b> the verified version. It becomes the workflow's official version; any previous active version is superseded. Activation records who and when.</li>
          </ol>
        </section>

        <section id="publish">
          <h2>Publish to toolkit</h2>
          <ul>
            <li>Only <b>verified</b> (or active) versions can be published — drafts and in-review versions are refused.</li>
            <li>Publishing records name, category, description, risk statement, publisher, and timestamp, pointing at the immutable version.</li>
            <li>Published tools appear in <b>Toolkit</b> and the template library; anyone can <b>clone</b> one into a fresh draft without touching the original.</li>
            <li><b>Unpublish</b> hides the tool but preserves the source workflow, its versions, and all evidence. Archiving a workflow auto-unpublishes its tools.</li>
          </ul>
        </section>

        <section id="ai">
          <h2>AI assist &amp; privacy</h2>
          <ul>
            <li>AI features are optional — everything in TraceForge works without them.</li>
            <li><b>Ollama (local)</b> is the default provider: prompts never leave this machine. Configure it in Settings (default <Code>http://127.0.0.1:11434</Code>) and use <b>Check</b> to test it with a real prompt.</li>
            <li><b>Cloud providers</b> (OpenAI, Azure AI Foundry — including Claude via the Foundry Messages API) must be added explicitly and <b>selected per action</b>; they can never become a silent default. API keys are encrypted at rest.</li>
            <li>What AI can do: draft a workflow from an objective (+ Workflow → AI-assisted draft), suggest expressions inside any expression field, explain expressions, and generate test logic — all outputs are schema-validated and shown for your review before anything is saved.</li>
            <li>What is shared: your description, and column names/types where relevant. Data rows are never sent unless you explicitly opt in on a node; secrets are redacted from every outbound prompt.</li>
          </ul>
        </section>

        <section id="troubleshooting">
          <h2>Troubleshooting</h2>
          <dl className="kv">
            <dt>“Column … was not found”</dt><dd>The expression references a column the input doesn't have at that point in the flow. Check upstream renames/selects — the message lists the available columns.</dd>
            <dt>“Required parameter … is missing”</dt><dd>Set a value in the Run dialog, or give the parameter a default on the Parameters tab.</dd>
            <dt>Run fails at Import File</dt><dd>The dataset parameter has no dataset selected for this run, or the bound dataset was removed.</dd>
            <dt>Version won't save</dt><dd>Only drafts are editable. Use <b>New draft from this</b> on the Versions tab.</dd>
            <dt>Can't pass verification</dt><dd>Pass requires a recorded tester and reviewer plus a linked <i>successful</i> sample run.</dd>
            <dt>Date conversion produced nulls</dt><dd>In Edit Columns, set the source format (e.g. <Code>YYYYMMDD</Code>) that matches the text; unparseable values become null.</dd>
            <dt>AI assist errors</dt><dd>Check Settings → provider health. For Ollama, make sure the Ollama app is running and a model is pulled.</dd>
            <dt>Import from API fails</dt><dd>The node needs Internet and refuses localhost/private addresses by design.</dd>
          </dl>
        </section>

        <p className="small dim" style={{ margin: "30px 0 10px" }}>
          TraceForge is local-first: your data, workflows, run history, and evidence stay on this machine unless you explicitly choose a cloud LLM provider.
        </p>
      </div>
    </div>
  );
}
