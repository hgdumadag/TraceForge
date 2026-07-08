/** File import (features/data-import.md): CSV, Excel, JSON, Parquet → Parquet snapshot. */
import { readFileSync } from "node:fs";
import { stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";
import * as XLSX from "xlsx";

// SheetJS fs-bound APIs (readFile/writeFile) are unavailable or unwired in ESM
// contexts (Node CJS-interop misses `readFile`; the .mjs build never wires `fs`),
// so workbooks are read from buffers via `XLSX.read` instead.
function readWorkbook(filePath: string, opts: XLSX.ParsingOptions = {}): XLSX.WorkBook {
  return XLSX.read(readFileSync(filePath), { type: "buffer", ...opts });
}
import {
  withConnection,
  materializeToParquet,
  hashFile,
  escapePath,
  type MaterializedInfo
} from "./duck.js";

export type ImportFormat = "csv" | "xlsx" | "json" | "parquet";

export interface FileFingerprint {
  fileName: string;
  size: number;
  contentHash: string;
}

export interface ImportResult extends MaterializedInfo {
  fingerprint: FileFingerprint;
  sheetNames?: string[];
}

export function detectFormat(fileName: string): ImportFormat {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case ".csv": case ".txt": case ".tsv": return "csv";
    case ".xlsx": case ".xls": return "xlsx";
    case ".json": case ".ndjson": case ".jsonl": return "json";
    case ".parquet": return "parquet";
    default:
      throw new Error(
        `Unsupported file format "${ext || fileName}". Supported formats: CSV, Excel (.xlsx), JSON, Parquet.`
      );
  }
}

export function listExcelSheets(filePath: string): string[] {
  const wb = readWorkbook(filePath, { bookSheets: true });
  return wb.SheetNames;
}

/**
 * Import a source file into an immutable Parquet snapshot at `outPath`.
 * Excel files are converted sheet→CSV first (SheetJS), then read by DuckDB
 * so type inference matches CSV behavior.
 */
export async function importFileToParquet(
  filePath: string,
  fileName: string,
  outPath: string,
  options: { format?: ImportFormat; sheet?: string } = {}
): Promise<ImportResult> {
  const format = options.format ?? detectFormat(fileName);
  const st = await stat(filePath);
  if (st.size === 0) {
    throw new Error("The file is empty. Import a file with at least a header row.");
  }
  const contentHash = await hashFile(filePath);
  const fingerprint: FileFingerprint = { fileName, size: st.size, contentHash };
  await mkdir(dirname(outPath), { recursive: true });

  let readerSql: string;
  let sheetNames: string[] | undefined;
  let tempCsvPath: string | null = null;

  if (format === "xlsx") {
    const wb = readWorkbook(filePath);
    sheetNames = wb.SheetNames;
    const sheet = options.sheet ?? wb.SheetNames[0];
    if (!wb.Sheets[sheet]) {
      throw new Error(`Sheet "${sheet}" was not found. Available sheets: ${wb.SheetNames.join(", ")}.`);
    }
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet], { blankrows: false });
    if (!csv.trim()) throw new Error(`Sheet "${sheet}" is empty.`);
    tempCsvPath = `${outPath}.tmp.csv`;
    await writeFile(tempCsvPath, csv, "utf8");
    readerSql = `read_csv(${escapePath(tempCsvPath)}, header = true, sample_size = -1)`;
  } else if (format === "csv") {
    readerSql = `read_csv(${escapePath(filePath)}, header = true, sample_size = -1)`;
  } else if (format === "json") {
    readerSql = `read_json_auto(${escapePath(filePath)})`;
  } else {
    readerSql = `read_parquet(${escapePath(filePath)})`;
  }

  const info = await withConnection(async (conn) => {
    return materializeToParquet(conn, `SELECT * FROM ${readerSql}`, outPath);
  });

  if (tempCsvPath) {
    const { unlink } = await import("node:fs/promises");
    await unlink(tempCsvPath).catch(() => {});
  }

  // Duplicate column names are auto-uniquified by DuckDB; surface a clear error if any remain.
  const seen = new Set<string>();
  for (const c of info.columns) {
    if (seen.has(c.name)) throw new Error(`Duplicate column name "${c.name}" in imported file.`);
    seen.add(c.name);
  }

  return { ...info, fingerprint, sheetNames };
}

/** Build a Parquet snapshot from in-memory rows (New Table node / manual tables). */
export async function rowsToParquet(
  columns: { name: string; type: string }[],
  rows: (string | number | boolean | null)[][],
  outPath: string
): Promise<MaterializedInfo> {
  await mkdir(dirname(outPath), { recursive: true });
  // Build a VALUES clause with explicit casts; empty tables get LIMIT 0.
  const { duckCastType, quoteIdent, withConnection: withConn, materializeToParquet: mat } = await import("./duck.js");
  const colDefs = columns.map((c) => `${quoteIdent(c.name)}`);
  const castSelect = columns
    .map((c, i) => `TRY_CAST(v.${quoteIdent(`col${i}`)} AS ${duckCastType(c.type as never)}) AS ${quoteIdent(c.name)}`)
    .join(", ");
  let sql: string;
  if (rows.length === 0) {
    sql = `SELECT ${columns.map((c) => `NULL::${duckCastType(c.type as never)} AS ${quoteIdent(c.name)}`).join(", ")} LIMIT 0`;
  } else {
    const values = rows
      .map((r) => `(${columns.map((_, i) => literal(r[i] ?? null)).join(", ")})`)
      .join(", ");
    sql = `SELECT ${castSelect} FROM (VALUES ${values}) AS v(${columns.map((_, i) => `col${i}`).join(", ")})`;
  }
  void colDefs;
  return withConn(async (conn) => mat(conn, sql, outPath));
}

function literal(v: string | number | boolean | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${v.replace(/'/g, "''")}'`;
}
