/** Read-only previews, profiling, and export (features/data-preview.md). */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as XLSX from "xlsx";
import type { DatasetColumn } from "@traceforge/domain";
import { withConnection, query, exec, parquetSource, escapePath, quoteIdent as qi } from "./duck.js";

export interface PreviewResult {
  columns: DatasetColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  limit: number;
  offset: number;
}

export async function previewParquet(path: string, limit = 100, offset = 0): Promise<PreviewResult> {
  return withConnection(async (conn) => {
    const count = await query(conn, `SELECT COUNT(*)::BIGINT AS n FROM ${parquetSource(path)}`);
    const totalRows = Number(count.rows[0]?.n ?? 0);
    const data = await query(
      conn,
      `SELECT * FROM ${parquetSource(path)} LIMIT ${Math.min(limit, 1000)} OFFSET ${Math.max(0, offset)}`
    );
    return { columns: data.columns, rows: data.rows, totalRows, limit, offset };
  });
}

export interface ColumnProfile {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  min: unknown;
  max: unknown;
}

export async function profileParquet(path: string): Promise<ColumnProfile[]> {
  return withConnection(async (conn) => {
    const schema = await query(conn, `SELECT * FROM ${parquetSource(path)} LIMIT 0`);
    const profiles: ColumnProfile[] = [];
    for (const col of schema.columns) {
      const numericOrDate = ["integer", "decimal", "date", "datetime"].includes(col.type);
      const minMax = numericOrDate
        ? `min(${qi(col.name)}) AS mn, max(${qi(col.name)}) AS mx`
        : `NULL AS mn, NULL AS mx`;
      const r = await query(
        conn,
        `SELECT COUNT(*) - COUNT(${qi(col.name)}) AS nulls, approx_count_distinct(${qi(col.name)}) AS dc, ${minMax} FROM ${parquetSource(path)}`
      );
      const row = r.rows[0] ?? {};
      profiles.push({
        name: col.name,
        type: col.type,
        nullCount: Number(row.nulls ?? 0),
        distinctCount: Number(row.dc ?? 0),
        min: row.mn ?? null,
        max: row.mx ?? null
      });
    }
    return profiles;
  });
}

export type ExportFormat = "csv" | "xlsx" | "parquet";

/** Export a dataset snapshot to CSV/Excel/Parquet. Exported rows match the snapshot exactly. */
export async function exportParquet(path: string, outPath: string, format: ExportFormat): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  if (format === "csv") {
    await withConnection((conn) =>
      exec(conn, `COPY (SELECT * FROM ${parquetSource(path)}) TO ${escapePath(outPath)} (FORMAT CSV, HEADER)`)
    );
    return;
  }
  if (format === "parquet") {
    await withConnection((conn) =>
      exec(conn, `COPY (SELECT * FROM ${parquetSource(path)}) TO ${escapePath(outPath)} (FORMAT PARQUET)`)
    );
    return;
  }
  const data = await withConnection((conn) => query(conn, `SELECT * FROM ${parquetSource(path)}`));
  const rows = data.rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of data.columns) out[c.name] = r[c.name];
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(rows, { header: data.columns.map((c) => c.name) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, outPath);
}
