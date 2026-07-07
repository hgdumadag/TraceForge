/**
 * Python node runner. Custom code NEVER runs in the main process (ADR-010):
 * the input dataset is exported to CSV, an isolated `python3` child process
 * transforms it, and the resulting CSV is re-imported as a new snapshot.
 * The child gets a minimal environment (no inherited secrets).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportParquet } from "./preview.js";
import { importFileToParquet } from "./importers.js";
import type { MaterializedInfo } from "./duck.js";

const RUNNER = `
import csv, sys, json
INPUT_PATH = sys.argv[1]
OUTPUT_PATH = sys.argv[2]
USER_CODE_PATH = sys.argv[3]

with open(INPUT_PATH, newline='', encoding='utf-8') as f:
    rows = list(csv.DictReader(f))

scope = {'rows': rows}
with open(USER_CODE_PATH, encoding='utf-8') as f:
    code = f.read()
exec(compile(code, 'user_code.py', 'exec'), scope)
result = scope.get('rows', rows)
if not isinstance(result, list):
    raise SystemExit('The Python node must leave a list of dict rows in the variable "rows".')

fieldnames = []
for row in result:
    for key in row.keys():
        if key not in fieldnames:
            fieldnames.append(key)
with open(OUTPUT_PATH, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(result)
`;

export interface PythonRunResult extends MaterializedInfo {
  stdout: string;
  stderr: string;
}

export async function runPythonNode(
  inputParquetPath: string,
  code: string,
  outputParquetPath: string,
  timeoutMs = 60000
): Promise<PythonRunResult> {
  const dir = await mkdtemp(join(tmpdir(), "tf-python-"));
  try {
    const inputCsv = join(dir, "input.csv");
    const outputCsv = join(dir, "output.csv");
    const runnerPath = join(dir, "runner.py");
    const codePath = join(dir, "user_code.py");
    await exportParquet(inputParquetPath, inputCsv, "csv");
    await writeFile(runnerPath, RUNNER, "utf8");
    await writeFile(codePath, code, "utf8");

    const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
      (resolve, reject) => {
        const child = spawn("python3", ["-I", runnerPath, inputCsv, outputCsv, codePath], {
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, // minimal env, no secrets
          cwd: dir,
          timeout: timeoutMs
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += String(d)));
        child.stderr.on("data", (d) => (err += String(d)));
        child.on("error", reject);
        child.on("close", (codeNum) => resolve({ stdout: out, stderr: err, exitCode: codeNum ?? 1 }));
      }
    );

    if (exitCode !== 0) {
      throw new Error(`Python node failed (exit ${exitCode}): ${stderr.slice(0, 2000) || stdout.slice(0, 500)}`);
    }
    const st = await stat(outputCsv).catch(() => null);
    if (!st || st.size === 0) {
      throw new Error("Python node produced no output. Leave the transformed rows in the `rows` variable.");
    }
    const info = await importFileToParquet(outputCsv, "python-output.csv", outputParquetPath, { format: "csv" });
    return { rowCount: info.rowCount, columns: info.columns, contentHash: info.contentHash, stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
