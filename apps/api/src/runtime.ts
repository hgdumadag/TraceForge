/** NodeRuntime implementation: binds the workflow engine to the tabular engine,
 * dataset store, Python sandbox, HTTP import (with SSRF guards), and LLM gateway. */
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import {
  executeTabularNode,
  rowsToParquet,
  importFileToParquet,
  runPythonNode,
  type TabularInput
} from "@traceforge/tabular-engine";
import type { NodeRuntime, NodeExecuteRequest, NodeExecuteResult, PortData } from "@traceforge/workflow-engine";
import { getNodeType, validateNodeConfig, newId, type ColumnType } from "@traceforge/domain";
import type { LlmGateway } from "@traceforge/llm-gateway";
import type { Store } from "./store.js";
import type { AppPaths } from "./db.js";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(ip));
}

/** SSRF guard for the Import from API node (project.md §8.4). */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`"${rawUrl}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed for API imports.");
  }
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(url.hostname))) {
    throw new Error("API imports cannot target localhost or private network addresses.");
  }
  try {
    const { address } = await lookup(url.hostname);
    if (isPrivateIp(address)) {
      throw new Error("API imports cannot target addresses that resolve to private networks.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("private")) throw e;
    // DNS failure: let fetch surface the network error with a clear message.
  }
  return url;
}

export interface RuntimeDeps {
  store: Store;
  paths: AppPaths;
  gateway: LlmGateway;
  actor: string;
}

export class ApiNodeRuntime implements NodeRuntime {
  /** dataset version ids used as inputs during this run (for evidence). */
  usedInputDatasetVersions = new Set<string>();

  constructor(private deps: RuntimeDeps) {}

  private toTabularInput(data: PortData): TabularInput {
    return { path: data.path, columns: data.columns as TabularInput["columns"], rowCount: data.rowCount };
  }

  /** Persist a produced Parquet output as an immutable dataset version. */
  private registerOutput(
    nodeLabel: string,
    handle: string,
    info: { rowCount: number; columns: { name: string; type: string }[]; contentHash: string },
    path: string
  ): PortData {
    const dataset = this.deps.store.createDataset(`${nodeLabel} — ${handle}`, "node_output");
    const dsv = this.deps.store.createDatasetVersion({
      datasetId: dataset.id,
      storagePath: path,
      contentHash: info.contentHash,
      sourceFileName: null,
      sourceFileHash: null,
      sourceFileSize: null,
      rowCount: info.rowCount,
      columns: info.columns as never
    });
    return {
      datasetVersionId: dsv.id,
      path,
      columns: info.columns,
      rowCount: info.rowCount,
      contentHash: info.contentHash
    };
  }

  private outputPath(executionId: string, nodeId: string, handle: string): string {
    return join(this.deps.paths.datasetsDir, "runs", executionId, `${nodeId}_${handle}.parquet`);
  }

  private async textTable(
    executionId: string,
    nodeId: string,
    nodeLabel: string,
    rows: Record<string, string>[]
  ): Promise<Record<string, PortData>> {
    const columns = Object.keys(rows[0] ?? { Response: "" }).map((name) => ({ name, type: "text" as ColumnType }));
    const path = this.outputPath(executionId, nodeId, "output");
    await mkdir(join(this.deps.paths.datasetsDir, "runs", executionId), { recursive: true });
    const info = await rowsToParquet(
      columns,
      rows.map((r) => columns.map((c) => r[c.name] ?? null)),
      path
    );
    return { output: this.registerOutput(nodeLabel, "output", info, path) };
  }

  async execute(req: NodeExecuteRequest): Promise<NodeExecuteResult> {
    const def = getNodeType(req.node.type);
    if (!def) throw new Error(`Unknown node type "${req.node.type}".`);
    const label = req.node.label ?? def.label;
    const cfgResult = validateNodeConfig(req.node.type, req.node.config);
    if (!cfgResult.ok) throw new Error(cfgResult.errors.join(" "));
    const cfg = cfgResult.config as Record<string, any>;
    const { store, paths, gateway } = this.deps;
    await mkdir(join(paths.datasetsDir, "runs", req.executionId), { recursive: true });

    switch (req.node.type) {
      case "import_file": {
        let dsvId: string | undefined = cfg.datasetVersionId;
        if (!dsvId && cfg.datasetParameterKey) {
          const v = req.parameterValues[cfg.datasetParameterKey];
          if (typeof v !== "string" || !v) {
            throw new Error(`${label}: dataset parameter "${cfg.datasetParameterKey}" has no dataset selected for this run.`);
          }
          dsvId = v;
        }
        if (!dsvId) throw new Error(`${label}: no dataset selected.`);
        const dsv = store.getDatasetVersion(dsvId);
        this.usedInputDatasetVersions.add(dsv.id);
        return {
          outputs: {
            output: {
              datasetVersionId: dsv.id,
              path: dsv.storagePath,
              columns: dsv.columns,
              rowCount: dsv.rowCount,
              contentHash: dsv.contentHash
            }
          },
          logs: [`${label}: loaded ${dsv.rowCount} rows (${dsv.sourceFileName ?? "stored dataset"})`]
        };
      }

      case "import_sample": {
        const sample = store.listDatasets(["sample"]).find((d) => d.id === cfg.sampleId || d.name === cfg.sampleId);
        if (!sample?.latestVersion) {
          throw new Error(`${label}: sample dataset "${cfg.sampleId}" was not found.`);
        }
        const dsv = sample.latestVersion;
        this.usedInputDatasetVersions.add(dsv.id);
        return {
          outputs: {
            output: { datasetVersionId: dsv.id, path: dsv.storagePath, columns: dsv.columns, rowCount: dsv.rowCount, contentHash: dsv.contentHash }
          },
          logs: [`${label}: loaded sample "${sample.name}" (${dsv.rowCount} rows)`]
        };
      }

      case "new_table": {
        const path = this.outputPath(req.executionId, req.node.id, "output");
        const info = await rowsToParquet(cfg.columns, cfg.rows, path);
        return { outputs: { output: this.registerOutput(label, "output", info, path) }, logs: [`${label}: created ${info.rowCount} rows`] };
      }

      case "import_api": {
        const url = await assertSafeUrl(cfg.url);
        const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
        if (cfg.credentialId) {
          throw new Error(`${label}: credential references are not yet supported in this build. Remove the credential or use a public endpoint.`);
        }
        let res: Response;
        try {
          res = await fetch(url, {
            method: cfg.method ?? "GET",
            headers,
            body: cfg.method === "POST" ? cfg.body : undefined,
            redirect: "error",
            signal: AbortSignal.timeout(30000)
          });
        } catch (e) {
          throw new Error(`${label}: the API is unreachable. Check the URL and your network connection. (${e instanceof Error ? e.message : e})`);
        }
        if (!res.ok) throw new Error(`${label}: the API returned status ${res.status}.`);
        let json: any = await res.json();
        if (cfg.recordsPath) {
          for (const part of String(cfg.recordsPath).split(".")) {
            json = json?.[part];
          }
        }
        if (!Array.isArray(json)) throw new Error(`${label}: expected an array of records${cfg.recordsPath ? ` at "${cfg.recordsPath}"` : ""}.`);
        const tmp = join(paths.datasetsDir, "runs", req.executionId, `${req.node.id}_api.json`);
        await writeFile(tmp, JSON.stringify(json), "utf8");
        const path = this.outputPath(req.executionId, req.node.id, "output");
        const info = await importFileToParquet(tmp, "api-import.json", path, { format: "json" });
        await rm(tmp, { force: true }).catch(() => {});
        return {
          outputs: { output: this.registerOutput(label, "output", info, path) },
          logs: [`${label}: imported ${info.rowCount} records from ${url.hostname}`]
        };
      }

      case "python": {
        const input = req.inputs["input"]?.[0];
        if (!input) throw new Error(`${label}: input is not connected.`);
        const path = this.outputPath(req.executionId, req.node.id, "output");
        const result = await runPythonNode(input.path, cfg.code, path, cfg.timeoutMs);
        return {
          outputs: { output: this.registerOutput(label, "output", result, path) },
          logs: [
            `${label}: produced ${result.rowCount} rows`,
            ...(result.stdout ? [`stdout: ${result.stdout.slice(0, 500)}`] : [])
          ]
        };
      }

      case "publish_toolkit": {
        const input = req.inputs["input"]?.[0];
        return {
          outputs: {},
          logs: [`${label}: terminal output marked for toolkit publishing (${input?.rowCount ?? 0} rows).`],
          summary: { note: "Publishing happens from the workflow's Publish action once the version is verified." }
        };
      }

      case "llm_chat": {
        const input = req.inputs["input"]?.[0];
        let prompt = String(cfg.prompt);
        if (cfg.includeSchema && input) {
          prompt += `\n\nInput data schema (column names and types only, no rows): ${input.columns.map((c) => `${c.name}:${c.type}`).join(", ")}. Row count: ${input.rowCount}.`;
        }
        const res = await gateway.chat({ messages: [{ role: "user", content: prompt }] }, cfg.providerId || undefined);
        return { outputs: await this.textTable(req.executionId, req.node.id, label, [{ Response: res.content }]), logs: [`${label}: ${res.providerId} responded (${res.usage.latencyMs}ms)`] };
      }

      case "explain_expression": {
        const res = await gateway.chat(
          {
            messages: [
              { role: "system", content: "You explain audit analytics expressions in plain language for auditors. Expressions use {Column} references, {param!key} parameters, and functions like is_null, days_between, contains." },
              { role: "user", content: `Explain this expression:\n${cfg.expression}` }
            ]
          },
          cfg.providerId || undefined
        );
        return { outputs: await this.textTable(req.executionId, req.node.id, label, [{ Expression: String(cfg.expression), Explanation: res.content }]), logs: [] };
      }

      case "generate_test_logic": {
        const res = await gateway.chat(
          {
            messages: [
              { role: "system", content: "You draft audit test logic. Respond with a concise plan: inputs, parameters, filters/validations with expressions using {Column} and {param!key} syntax, and expected outputs. The user reviews before anything is saved (LLM output is untrusted)." },
              { role: "user", content: String(cfg.objective) }
            ]
          },
          cfg.providerId || undefined
        );
        return { outputs: await this.textTable(req.executionId, req.node.id, label, [{ Objective: String(cfg.objective), Proposal: res.content }]), logs: [] };
      }

      default: {
        // All remaining node types are tabular transforms executed by DuckDB.
        const inputs: Record<string, TabularInput[]> = {};
        for (const [handle, list] of Object.entries(req.inputs)) {
          inputs[handle] = list.map((d) => this.toTabularInput(d));
        }
        const result = await executeTabularNode({
          nodeType: req.node.type,
          nodeLabel: label,
          config: cfg,
          inputs,
          parameterDefinitions: req.parameterDefinitions,
          parameterValues: req.parameterValues,
          outputPathFor: (handle) => this.outputPath(req.executionId, req.node.id, handle)
        });
        const outputs: Record<string, PortData> = {};
        for (const out of result.outputs) {
          outputs[out.handle] = this.registerOutput(label, out.handle, out, out.path);
        }
        return { outputs, logs: result.logs };
      }
    }
  }
}
