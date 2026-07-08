/** Boots the built TraceForge app for E2E tests with a fresh data directory. */
import { rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, ".e2e-data");

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

process.env.TRACEFORGE_DATA_DIR = dataDir;
process.env.TRACEFORGE_PORT = "4899";
process.env.TRACEFORGE_HOST = "127.0.0.1";

await import(join(root, "apps/api/dist/index.js"));
