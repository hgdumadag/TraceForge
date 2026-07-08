/** Dependency-free SVG chart renderer for Chart node outputs.
 * Reads {Dimension, Value} rows; colors come from CSS variables so both themes work. */
import { useMemo } from "react";

export interface ChartPoint {
  label: string;
  value: number;
}

const PALETTE = [
  "var(--accent)",
  "var(--green)",
  "var(--amber)",
  "var(--purple)",
  "var(--red)",
  "#4dc3c3",
  "#c37bd6",
  "#8fb35c",
  "#d68a5c",
  "#7b8fd6",
  "#5cb3a1",
  "#d65c8a"
];

const W = 760;
const H = 320;
const M = { top: 16, right: 20, bottom: 66, left: 64 };
const PW = W - M.left - M.right; // plot width
const PH = H - M.top - M.bottom; // plot height

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return abs >= 100 || Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** "Nice" axis ticks: 0 .. ceil(max) in 4 steps. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  // Always extend past the maximum so the tallest bar/point stays inside the plot.
  for (let v = 0; ; v += step) {
    out.push(v);
    if (v >= max) break;
  }
  return out;
}

function AxisChart({ data, render, xLabels }: { data: ChartPoint[]; render: (x: (i: number) => number, y: (v: number) => number, bw: number) => React.ReactNode; xLabels: boolean }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const tickVals = ticks(max);
  const top = tickVals[tickVals.length - 1] || 1;
  const y = (v: number) => M.top + PH - (v / top) * PH;
  const bw = PW / data.length;
  const x = (i: number) => M.left + i * bw;
  const every = Math.ceil(data.length / 16); // avoid label soup

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      {tickVals.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 0.5} />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-dim)">{fmt(t)}</text>
        </g>
      ))}
      {render(x, y, bw)}
      {xLabels &&
        data.map((d, i) =>
          i % every === 0 ? (
            <text
              key={i}
              x={x(i) + bw / 2}
              y={H - M.bottom + 14}
              fontSize="11"
              fill="var(--text-dim)"
              textAnchor="end"
              transform={`rotate(-35 ${x(i) + bw / 2} ${H - M.bottom + 14})`}
            >
              {truncate(d.label, 18)}
              <title>{d.label}</title>
            </text>
          ) : null
        )}
    </svg>
  );
}

function BarChart({ data }: { data: ChartPoint[] }) {
  return (
    <AxisChart
      data={data}
      xLabels
      render={(x, y, bw) => (
        <>
          {data.map((d, i) => (
            <g key={i}>
              <rect
                x={x(i) + bw * 0.12}
                y={y(Math.max(d.value, 0))}
                width={bw * 0.76}
                height={Math.abs(y(0) - y(d.value))}
                rx={2}
                fill="var(--accent)"
                opacity={0.9}
              >
                <title>{d.label}: {fmt(d.value)}</title>
              </rect>
              {data.length <= 20 && (
                <text x={x(i) + bw / 2} y={y(Math.max(d.value, 0)) - 4} textAnchor="middle" fontSize="10" fill="var(--text-dim)">
                  {fmt(d.value)}
                </text>
              )}
            </g>
          ))}
        </>
      )}
    />
  );
}

function HorizontalBarChart({ data }: { data: ChartPoint[] }) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const rowH = Math.min(34, Math.max(18, 300 / data.length));
  const height = M.top + data.length * rowH + 10;
  const labelW = 170;
  const plotW = W - labelW - 90;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart-svg" role="img">
      {data.map((d, i) => {
        const w = (Math.max(d.value, 0) / max) * plotW;
        const yPos = M.top + i * rowH;
        return (
          <g key={i}>
            <text x={labelW - 8} y={yPos + rowH / 2 + 4} textAnchor="end" fontSize="11" fill="var(--text)">
              {truncate(d.label, 26)}
              <title>{d.label}</title>
            </text>
            <rect x={labelW} y={yPos + rowH * 0.15} width={w} height={rowH * 0.7} rx={2} fill="var(--accent)" opacity={0.9}>
              <title>{d.label}: {fmt(d.value)}</title>
            </rect>
            <text x={labelW + w + 6} y={yPos + rowH / 2 + 4} fontSize="10" fill="var(--text-dim)">{fmt(d.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, area }: { data: ChartPoint[]; area: boolean }) {
  return (
    <AxisChart
      data={data}
      xLabels
      render={(x, y, bw) => {
        const pts = data.map((d, i) => [x(i) + bw / 2, y(d.value)] as const);
        const path = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
        const areaPath = `${path} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z`;
        return (
          <>
            {area && <path d={areaPath} fill="var(--accent)" opacity={0.18} />}
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {data.length <= 60 &&
              pts.map(([px, py], i) => (
                <circle key={i} cx={px} cy={py} r={3} fill="var(--accent)">
                  <title>{data[i].label}: {fmt(data[i].value)}</title>
                </circle>
              ))}
          </>
        );
      }}
    />
  );
}

function PieChart({ data, donut }: { data: ChartPoint[]; donut: boolean }) {
  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0) || 1;
  const cx = 180;
  const cy = 160;
  const r = 120;
  const inner = donut ? 62 : 0;
  let angle = -Math.PI / 2;

  const slices = data.map((d, i) => {
    const frac = Math.max(d.value, 0) / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (a: number, radius: number) => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
    const [x1, y1] = p(start, r);
    const [x2, y2] = p(end, r);
    let path: string;
    if (frac >= 0.999) {
      path = `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
    } else if (inner > 0) {
      const [x3, y3] = p(end, inner);
      const [x4, y4] = p(start, inner);
      path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
    } else {
      path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    }
    return { d, path, frac, color: PALETTE[i % PALETTE.length] };
  });

  return (
    <svg viewBox={`0 0 ${W} 320`} className="chart-svg" role="img">
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="var(--bg-panel)" strokeWidth={1.5} opacity={0.92}>
          <title>{s.d.label}: {fmt(s.d.value)} ({(s.frac * 100).toFixed(1)}%)</title>
        </path>
      ))}
      {donut && (
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--text)">
          {fmt(total)}
        </text>
      )}
      <g>
        {slices.slice(0, 12).map((s, i) => (
          <g key={i} transform={`translate(360, ${28 + i * 22})`}>
            <rect width={12} height={12} rx={2} fill={s.color} />
            <text x={18} y={10} fontSize="11.5" fill="var(--text)">
              {truncate(s.d.label, 34)} — {fmt(s.d.value)} ({(s.frac * 100).toFixed(1)}%)
            </text>
          </g>
        ))}
        {slices.length > 12 && (
          <text x={360} y={28 + 12 * 22} fontSize="11" fill="var(--text-dim)">
            +{slices.length - 12} more…
          </text>
        )}
      </g>
    </svg>
  );
}

export function ChartView({
  chartType,
  rows,
  labelColumn = "Dimension",
  valueColumn = "Value"
}: {
  chartType: string;
  rows: Record<string, unknown>[];
  labelColumn?: string;
  valueColumn?: string;
}) {
  const data: ChartPoint[] = useMemo(
    () =>
      rows
        .map((r) => ({ label: String(r[labelColumn] ?? "(null)"), value: Number(r[valueColumn] ?? 0) }))
        .filter((d) => Number.isFinite(d.value)),
    [rows, labelColumn, valueColumn]
  );

  if (data.length === 0) {
    return <div className="dim small">No data to chart — run the workflow to populate this output.</div>;
  }

  return (
    <div className="chart-view">
      {chartType === "horizontal_bar" ? (
        <HorizontalBarChart data={data} />
      ) : chartType === "line" ? (
        <LineChart data={data} area={false} />
      ) : chartType === "area" ? (
        <LineChart data={data} area />
      ) : chartType === "pie" ? (
        <PieChart data={data} donut={false} />
      ) : chartType === "donut" ? (
        <PieChart data={data} donut />
      ) : (
        <BarChart data={data} />
      )}
    </div>
  );
}
