/** SQLite metadata store using Node's built-in sqlite (no native build step). */
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";

// Loaded via process.getBuiltinModule so bundlers (vite/vitest) don't try to
// resolve the prefix-only "node:sqlite" specifier statically.
const { DatabaseSync } = (process as any).getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncType;
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  datasetsDir: string;
  exportsDir: string;
}

export function resolvePaths(dataDir?: string): AppPaths {
  const base = dataDir ?? process.env.TRACEFORGE_DATA_DIR ?? join(process.cwd(), "data");
  return {
    dataDir: base,
    dbPath: join(base, "traceforge.db"),
    datasetsDir: join(base, "datasets"),
    exportsDir: join(base, "exports")
  };
}

export function openDb(paths: AppPaths): DatabaseSync {
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.datasetsDir, { recursive: true });
  mkdirSync(paths.exportsDir, { recursive: true });
  const db = new DatabaseSync(paths.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Forward-only migrations from apps/api/migrations/*.sql (gates.md §11). */
export function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const here = dirname(fileURLToPath(import.meta.url));
  // Works from src (tsx) and dist (compiled) layouts.
  const candidates = [join(here, "../migrations"), join(here, "../../migrations")];
  let migrationsDir: string | null = null;
  for (const c of candidates) {
    try {
      readdirSync(c);
      migrationsDir = c;
      break;
    } catch {
      /* try next */
    }
  }
  if (!migrationsDir) throw new Error("Migrations directory not found.");
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
  );
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
