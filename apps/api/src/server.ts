/** TraceForge local API server. Binds to localhost only (project.md §8.4). */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  validateGraph,
  validateExpression,
  newId,
  type ExpressionContext
} from "@traceforge/domain";
import {
  importFileToParquet,
  rowsToParquet,
  previewParquet,
  profileParquet,
  exportParquet,
  listExcelSheets,
  detectFormat
} from "@traceforge/tabular-engine";
import { openDb, resolvePaths, type AppPaths } from "./db.js";
import { Store, StoreError } from "./store.js";
import { ExecutionService } from "./executions.js";
import { LlmService } from "./llm.js";
import { Vault } from "./crypto.js";
import { BUILT_IN_TEMPLATES, getTemplate, seedSampleDatasets } from "./templates.js";

export const APP_VERSION = "0.1.0";

export interface AppContext {
  app: FastifyInstance;
  store: Store;
  paths: AppPaths;
  executions: ExecutionService;
  llm: LlmService;
}

export async function buildApp(options: { dataDir?: string; webDist?: string } = {}): Promise<AppContext> {
  const paths = resolvePaths(options.dataDir);
  const db = openDb(paths);
  const store = new Store(db);
  const vault = new Vault(paths.dataDir);
  const llm = new LlmService(store, vault);
  const executions = new ExecutionService(store, paths, llm.gateway);
  await seedSampleDatasets(store, paths);

  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  // Release the SQLite file handle when the app shuts down — otherwise the .db/-wal/-shm
  // files stay locked (breaks Windows cleanup of temp data dirs, e.g. in tests).
  app.addHook("onClose", async () => {
    db.close();
  });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

  if (options.webDist && existsSync(options.webDist)) {
    await app.register(fastifyStatic, { root: options.webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, _req, reply) => {
    const status = error instanceof StoreError ? error.statusCode : (error as any).statusCode ?? 500;
    reply.code(status).send({ error: error.message });
  });

  const actor = () => store.getSetting("profile_name", "Local User");

  // --- Health / settings ----------------------------------------------------

  app.get("/api/health", async () => ({ ok: true, app: "TraceForge", version: APP_VERSION }));

  app.get("/api/settings", async () => ({
    profileName: store.getSetting("profile_name", "Local User"),
    reviewerName: store.getSetting("reviewer_name", ""),
    testerName: store.getSetting("tester_name", "")
  }));

  app.put("/api/settings", async (req) => {
    const body = req.body as Record<string, string>;
    if (body.profileName !== undefined) store.setSetting("profile_name", body.profileName);
    if (body.reviewerName !== undefined) store.setSetting("reviewer_name", body.reviewerName);
    if (body.testerName !== undefined) store.setSetting("tester_name", body.testerName);
    return { ok: true };
  });

  // --- Workflows -------------------------------------------------------------

  app.get("/api/workflows", async (req) => {
    const q = req.query as { includeArchived?: string; search?: string };
    return store.listWorkflows({ includeArchived: q.includeArchived === "true", search: q.search });
  });

  app.post("/api/workflows", async (req, reply) => {
    const body = req.body as any;
    if (body.templateId) {
      const template = getTemplate(body.templateId);
      if (!template) throw new StoreError(`Template ${body.templateId} was not found.`, 404);
      const created = store.createWorkflow({
        name: body.name ?? template.name,
        description: body.description ?? template.description,
        category: template.category,
        serviceTags: template.tags,
        owner: actor(),
        createdBy: actor(),
        templateSourceId: template.id,
        templateSourceVersion: template.version,
        graph: template.graph,
        parameters: template.parameters,
        notes: template.riskStatement ? `Risk addressed: ${template.riskStatement}` : ""
      });
      reply.code(201);
      return created;
    }
    if (body.duplicateOfWorkflowId) {
      const created = store.duplicateWorkflow(body.duplicateOfWorkflowId, actor(), body.name);
      reply.code(201);
      return created;
    }
    const created = store.createWorkflow({
      name: body.name,
      description: body.description,
      category: body.category,
      serviceTags: body.serviceTags,
      type: body.type,
      owner: actor(),
      createdBy: actor()
    });
    reply.code(201);
    return created;
  });

  app.get("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    const workflow = store.getWorkflow(id);
    return { workflow, versions: store.listVersions(id) };
  });

  app.patch("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    return store.updateWorkflowMetadata(id, req.body as any);
  });

  app.post("/api/workflows/:id/archive", async (req) => {
    const { id } = req.params as { id: string };
    return store.archiveWorkflow(id, actor());
  });

  app.post("/api/workflows/:id/restore", async (req) => {
    const { id } = req.params as { id: string };
    return store.restoreWorkflow(id, actor());
  });

  app.delete("/api/workflows/:id", async (req) => {
    const { id } = req.params as { id: string };
    store.hardDeleteWorkflow(id, actor());
    return { ok: true };
  });

  // --- Versions ----------------------------------------------------------------

  app.get("/api/versions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const version = store.getVersion(id);
    return { ...version, verification: store.latestVerification(id) };
  });

  app.put("/api/versions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    if (body.graph) {
      const version = store.getVersion(id);
      const validation = validateGraph(body.graph, { parameters: body.parameters ?? version.parameters });
      if (!validation.ok) {
        throw new StoreError(`Workflow cannot be saved: ${validation.errors.map((e) => e.message).join(" ")}`, 422);
      }
    }
    return store.updateDraftVersion(id, body);
  });

  app.post("/api/versions/:id/draft", async (req) => {
    const { id } = req.params as { id: string };
    return store.createDraftFrom(id, actor());
  });

  app.post("/api/versions/:id/validate", async (req) => {
    const { id } = req.params as { id: string };
    const version = store.getVersion(id);
    return validateGraph(version.graph, { parameters: version.parameters, forRun: true });
  });

  app.post("/api/versions/:id/submit", async (req) => {
    const { id } = req.params as { id: string };
    const version = store.getVersion(id);
    const validation = validateGraph(version.graph, { parameters: version.parameters, forRun: true });
    if (!validation.ok) {
      throw new StoreError(
        `The workflow must be valid before review: ${validation.errors.map((e) => e.message).join(" ")}`,
        422
      );
    }
    const updated = store.transitionVersion(id, "in_review", actor());
    store.upsertVerification(id, {});
    return updated;
  });

  app.post("/api/versions/:id/activate", async (req) => {
    const { id } = req.params as { id: string };
    return store.activateVersion(id, actor());
  });

  // --- Verification ---------------------------------------------------------------

  app.get("/api/versions/:id/verification", async (req) => {
    const { id } = req.params as { id: string };
    return store.latestVerification(id);
  });

  app.put("/api/versions/:id/verification", async (req) => {
    const { id } = req.params as { id: string };
    return store.upsertVerification(id, req.body as any);
  });

  app.post("/api/versions/:id/verification/sample-run", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as any;
    const version = store.getVersion(id);
    if (version.status !== "in_review") {
      throw new StoreError("Sample runs for verification require the version to be in review.", 409);
    }
    const execution = await executions.start({
      versionId: id,
      parameterValues: body.parameterValues ?? {},
      actor: actor(),
      triggerType: "verification_sample"
    });
    store.upsertVerification(id, { sampleExecutionId: execution.id });
    return execution;
  });

  app.post("/api/versions/:id/decide", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { decision: "pass" | "fail" | "amend"; notes?: string; amendComments?: string; reviewer?: string };
    if (body.reviewer) store.upsertVerification(id, { reviewer: body.reviewer });
    return store.decideVerification(id, body.decision, body.reviewer || actor(), body.notes ?? "", body.amendComments ?? "");
  });

  // --- Datasets -----------------------------------------------------------------------

  app.get("/api/datasets", async (req) => {
    const q = req.query as { kinds?: string };
    const kinds = q.kinds ? (q.kinds.split(",") as any) : undefined;
    return store.listDatasets(kinds);
  });

  app.get("/api/samples", async () => store.listDatasets(["sample"]));

  app.post("/api/datasets/import", async (req, reply) => {
    const file = await (req as any).file();
    if (!file) throw new StoreError("Attach a file to import.", 400);
    const fileName: string = file.filename;
    detectFormat(fileName); // throws early with a clear message for unsupported formats
    const uploadTmp = join(paths.dataDir, "uploads", `${newId("up")}_${fileName}`);
    await mkdir(join(paths.dataDir, "uploads"), { recursive: true });
    await pipeline(file.file, createWriteStream(uploadTmp));
    const fields = file.fields ?? {};
    const sheet = (fields.sheet as any)?.value as string | undefined;
    const requestedName = ((fields.name as any)?.value as string | undefined) ?? fileName.replace(/\.[^.]+$/, "");
    try {
      if (detectFormat(fileName) === "xlsx" && !sheet) {
        const sheets = listExcelSheets(uploadTmp);
        if (sheets.length > 1) {
          // Ask the user to choose a sheet; keep nothing.
          await rm(uploadTmp, { force: true });
          reply.code(422);
          return { needsSheetSelection: true, sheets };
        }
      }
      const dataset = store.createDataset(requestedName, "imported_file");
      const out = join(paths.datasetsDir, "imports", `${dataset.id}_${Date.now()}.parquet`);
      const info = await importFileToParquet(uploadTmp, fileName, out, { sheet });
      const dsv = store.createDatasetVersion({
        datasetId: dataset.id,
        storagePath: out,
        contentHash: info.contentHash,
        sourceFileName: fileName,
        sourceFileHash: info.fingerprint.contentHash,
        sourceFileSize: info.fingerprint.size,
        rowCount: info.rowCount,
        columns: info.columns
      });
      reply.code(201);
      return { dataset, datasetVersion: dsv, sheetNames: info.sheetNames };
    } finally {
      await rm(uploadTmp, { force: true }).catch(() => {});
    }
  });

  app.post("/api/datasets/table", async (req, reply) => {
    const body = req.body as { name: string; columns: { name: string; type: string }[]; rows: any[][] };
    if (!body.name?.trim()) throw new StoreError("Table name is required.");
    const dataset = store.createDataset(body.name.trim(), "manual_table");
    const out = join(paths.datasetsDir, "imports", `${dataset.id}.parquet`);
    const info = await rowsToParquet(body.columns, body.rows ?? [], out);
    const dsv = store.createDatasetVersion({
      datasetId: dataset.id,
      storagePath: out,
      contentHash: info.contentHash,
      sourceFileName: null,
      sourceFileHash: null,
      sourceFileSize: null,
      rowCount: info.rowCount,
      columns: info.columns
    });
    reply.code(201);
    return { dataset, datasetVersion: dsv };
  });

  app.patch("/api/datasets/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name: string };
    return store.renameDataset(id, body.name);
  });

  app.get("/api/dataset-versions/:id/preview", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    const dsv = store.getDatasetVersion(id);
    return previewParquet(dsv.storagePath, Number(q.limit ?? 100), Number(q.offset ?? 0));
  });

  app.get("/api/dataset-versions/:id/profile", async (req) => {
    const { id } = req.params as { id: string };
    const dsv = store.getDatasetVersion(id);
    return profileParquet(dsv.storagePath);
  });

  app.get("/api/dataset-versions/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { format?: string };
    const format = (q.format ?? "csv") as "csv" | "xlsx" | "parquet";
    const dsv = store.getDatasetVersion(id);
    const ds = store.getDataset(dsv.datasetId);
    const safeName = ds.name.replace(/[^\w.-]+/g, "_");
    const out = join(paths.exportsDir, `${safeName}_${id}.${format}`);
    await exportParquet(dsv.storagePath, out, format);
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(out);
    reply
      .header("content-disposition", `attachment; filename="${safeName}.${format}"`)
      .header("content-type", format === "csv" ? "text/csv" : "application/octet-stream");
    return reply.send(buf);
  });

  // --- Expression assistance -------------------------------------------------------------

  app.post("/api/expressions/validate", async (req) => {
    const body = req.body as { expression: string; columns: Record<string, any>; parameters: any[] };
    return validateExpression(body.expression, {
      columns: body.columns ?? {},
      parameters: body.parameters ?? []
    } as ExpressionContext);
  });

  // --- Executions ----------------------------------------------------------------------------

  app.post("/api/versions/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { parameterValues?: Record<string, unknown> };
    const execution = await executions.start({
      versionId: id,
      parameterValues: body.parameterValues ?? {},
      actor: actor()
    });
    reply.code(202);
    return execution;
  });

  app.get("/api/executions", async (req) => {
    const q = req.query as { workflowId?: string };
    return executions ? store.listExecutions(q.workflowId) : [];
  });

  app.get("/api/executions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const execution = store.getExecution(id);
    return { execution, nodeExecutions: store.listNodeExecutions(id) };
  });

  app.post("/api/executions/:id/cancel", async (req) => {
    const { id } = req.params as { id: string };
    store.getExecution(id);
    await executions.cancel(id);
    return { ok: true };
  });

  app.post("/api/executions/:id/rerun", async (req, reply) => {
    const { id } = req.params as { id: string };
    const execution = await executions.rerun(id, actor());
    reply.code(202);
    return execution;
  });

  app.get("/api/executions/:id/evidence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { format?: string };
    const pkg = executions.buildEvidence(id, APP_VERSION);
    if (q.format === "markdown") {
      reply.header("content-type", "text/markdown");
      return reply.send(pkg.markdown);
    }
    return { record: pkg.record, hash: pkg.hash };
  });

  app.get("/api/executions/:id/events", (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });
    const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    // Replay current state so late subscribers see a consistent picture.
    try {
      const execution = store.getExecution(id);
      send({ type: "execution", executionId: id, data: { status: execution.status } });
      for (const n of store.listNodeExecutions(id)) {
        send({ type: "node", executionId: id, data: { nodeId: n.nodeId, status: n.status, error: n.error, outputSummary: n.outputSummary, outputDatasetVersionIds: n.outputDatasetVersionIds } });
      }
      if (["succeeded", "failed", "cancelled"].includes(execution.status)) {
        send({ type: "done", executionId: id, data: { status: execution.status, errorSummary: execution.errorSummary } });
      }
    } catch {
      /* execution may not exist yet */
    }
    const unsubscribe = executions.subscribe(id, send);
    req.raw.on("close", unsubscribe);
  });

  // --- Templates & toolkit ---------------------------------------------------------------------

  app.get("/api/templates", async () => {
    const tools = store.listPublishedTools();
    return {
      builtIn: BUILT_IN_TEMPLATES.map((t) => ({ ...t, graph: undefined, nodeCount: t.graph.nodes.length })),
      publishedTools: tools
    };
  });

  app.get("/api/templates/:id", async (req) => {
    const { id } = req.params as { id: string };
    const template = getTemplate(id);
    if (!template) throw new StoreError(`Template ${id} was not found.`, 404);
    return template;
  });

  app.get("/api/toolkit", async () => store.listPublishedTools());

  app.post("/api/versions/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as any;
    const tool = store.publishTool({
      versionId: id,
      name: body.name,
      category: body.category,
      description: body.description,
      riskStatement: body.riskStatement,
      actor: actor()
    });
    reply.code(201);
    return tool;
  });

  app.post("/api/toolkit/:id/unpublish", async (req) => {
    const { id } = req.params as { id: string };
    return store.unpublishTool(id, actor());
  });

  app.post("/api/toolkit/:id/clone", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string };
    const tool = store.getPublishedTool(id);
    const sourceVersion = store.getVersion(tool.sourceWorkflowVersionId);
    const created = store.createWorkflow({
      name: body.name ?? `${tool.name} (from toolkit)`,
      description: tool.description,
      category: tool.category,
      owner: actor(),
      createdBy: actor(),
      templateSourceId: tool.id,
      graph: sourceVersion.graph,
      parameters: sourceVersion.parameters,
      notes: sourceVersion.notes
    });
    reply.code(201);
    return created;
  });

  // --- LLM -----------------------------------------------------------------------------------------

  app.get("/api/llm/providers", async () => {
    return llm.gateway.listProviders().map((p) => ({
      ...p,
      requiresInternet: p.kind === "cloud",
      warning: p.kind === "cloud" ? "Cloud provider: prompts leave this machine. Data is redacted, sample rows are never sent without opt-in." : null
    }));
  });

  app.post("/api/llm/providers", async (req, reply) => {
    const body = req.body as any;
    if (!["ollama", "openai", "azure_foundry", "mock"].includes(body.type)) {
      throw new StoreError(`Unknown provider type "${body.type}".`);
    }
    if ((body.type === "openai" || body.type === "azure_foundry") && !body.apiKey && !body.id) {
      throw new StoreError("Cloud providers require an API key.");
    }
    const id = body.id ?? newId("llmp");
    store.saveLlmProvider({
      id,
      type: body.type,
      displayName: body.displayName ?? body.type,
      baseUrl: body.baseUrl,
      model: body.model,
      deployment: body.deployment,
      apiVersion: body.apiVersion,
      apiKeyEncrypted: body.apiKey ? vault.encrypt(body.apiKey) : null,
      timeoutMs: body.timeoutMs,
      isDefault: !!body.isDefault
    });
    llm.reload();
    reply.code(201);
    return { id };
  });

  app.delete("/api/llm/providers/:id", async (req) => {
    const { id } = req.params as { id: string };
    store.deleteLlmProvider(id);
    llm.reload();
    return { ok: true };
  });

  app.get("/api/llm/providers/:id/health", async (req) => {
    const { id } = req.params as { id: string };
    return llm.gateway.getProvider(id).healthCheck();
  });

  app.post("/api/llm/chat", async (req) => {
    const body = req.body as { prompt: string; providerId?: string };
    const res = await llm.gateway.chat({ messages: [{ role: "user", content: body.prompt }] }, body.providerId);
    return { content: res.content, providerId: res.providerId, model: res.model, latencyMs: res.usage.latencyMs };
  });

  app.post("/api/llm/generate-workflow", async (req) => {
    const body = req.body as { objective: string; providerId?: string };
    return llm.generateWorkflowDraft(body.objective, body.providerId);
  });

  app.post("/api/llm/suggest-expression", async (req) => {
    const body = req.body as { request: string; columns: Record<string, any>; parameters: any[]; providerId?: string };
    return llm.suggestExpression(body.request, { columns: body.columns ?? {}, parameters: body.parameters ?? [] }, body.providerId);
  });

  return { app, store, paths, executions, llm };
}
