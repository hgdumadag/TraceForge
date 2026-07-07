/** DuckDB connection helpers, type mapping, and Parquet materialization. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { ColumnType, DatasetColumn } from "@traceforge/domain";
import { quoteIdentifier } from "@traceforge/domain";

let instancePromise: Promise<DuckDBInstance> | null = null;

async function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) instancePromise = DuckDBInstance.create(":memory:");
  return instancePromise;
}

export async function withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await getInstance();
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync?.();
  }
}

export interface QueryResult {
  columns: DatasetColumn[];
  rows: Record<string, unknown>[];
}

export function mapDuckType(duckType: string): ColumnType {
  const t = duckType.toUpperCase();
  if (t.includes("VARCHAR") || t.includes("STRING") || t === "UUID") return "text";
  if (t.startsWith("DECIMAL") || t === "DOUBLE" || t === "FLOAT" || t === "REAL") return "decimal";
  if (t.includes("BIGINT") || t.includes("INT")) return "integer";
  if (t === "BOOLEAN") return "boolean";
  if (t.startsWith("TIMESTAMP") || t === "DATETIME") return "datetime";
  if (t === "DATE") return "date";
  return "unknown";
}

/** ColumnType -> DuckDB cast target. */
export function duckCastType(type: ColumnType): string {
  switch (type) {
    case "text": return "VARCHAR";
    case "integer": return "BIGINT";
    case "decimal": return "DOUBLE";
    case "boolean": return "BOOLEAN";
    case "date": return "DATE";
    case "datetime": return "TIMESTAMP";
    default: return "VARCHAR";
  }
}

export async function query(conn: DuckDBConnection, sql: string): Promise<QueryResult> {
  const reader = await conn.runAndReadAll(sql);
  const names = reader.columnNames();
  const types = reader.columnTypes().map((t) => mapDuckType(String(t)));
  const columns: DatasetColumn[] = names.map((name, i) => ({ name, type: types[i] ?? "unknown" }));
  // getRowObjectsJson renders every value as a JSON-safe string/null;
  // convert numeric and boolean columns back to native JS values.
  const rawRows = reader.getRowObjectsJson() as Record<string, unknown>[];
  const rows = rawRows.map((row) => {
    const out: Record<string, unknown> = {};
    names.forEach((name, i) => {
      const v = row[name];
      const t = types[i];
      if (v === null || v === undefined) {
        out[name] = null;
      } else if ((t === "integer" || t === "decimal") && typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) {
        const n = Number(v);
        out[name] = Number.isSafeInteger(n) || t === "decimal" ? n : v;
      } else if (t === "boolean" && typeof v === "string") {
        out[name] = v === "true";
      } else {
        out[name] = v;
      }
    });
    return out;
  });
  return { columns, rows };
}

export async function exec(conn: DuckDBConnection, sql: string): Promise<void> {
  await conn.run(sql);
}

export function escapePath(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

/** SQL fragment reading a stored dataset version (Parquet). */
export function parquetSource(path: string): string {
  return `read_parquet(${escapePath(path)})`;
}

export interface MaterializedInfo {
  rowCount: number;
  columns: DatasetColumn[];
  contentHash: string;
}

/** Write a SELECT to a Parquet file and return its schema, row count, and hash. */
export async function materializeToParquet(
  conn: DuckDBConnection,
  selectSql: string,
  outPath: string
): Promise<MaterializedInfo> {
  await exec(conn, `COPY (${selectSql}) TO ${escapePath(outPath)} (FORMAT PARQUET)`);
  const meta = await query(
    conn,
    `SELECT COUNT(*)::BIGINT AS n FROM ${parquetSource(outPath)}`
  );
  const rowCount = Number(meta.rows[0]?.n ?? 0);
  const schema = await query(conn, `SELECT * FROM ${parquetSource(outPath)} LIMIT 0`);
  const contentHash = await hashFile(outPath);
  return { rowCount, columns: schema.columns, contentHash };
}

export async function hashFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

export function quoteIdent(name: string): string {
  return quoteIdentifier(name);
}
