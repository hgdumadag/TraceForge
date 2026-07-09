/** Execution service: runs workflow versions through the queue, persists
 * run history + node results, and streams events to the UI. */
import { EventEmitter } from "node:events";
import {
  executeWorkflow,
  LocalExecutionQueue,
  WorkflowValidationError,
  type NodeRunRecord
} from "@traceforge/workflow-engine";
import { buildEvidencePackage, type EvidencePackage } from "@traceforge/evidence";
import { nowIso, type Execution } from "@traceforge/domain";
import type { LlmGateway } from "@traceforge/llm-gateway";
import { Store, StoreError } from "./store.js";
import { ApiNodeRuntime } from "./runtime.js";
import type { AppPaths } from "./db.js";

export interface ExecutionEvent {
  type: "execution" | "node" | "log" | "done";
  executionId: string;
  data: unknown;
}

export class ExecutionService {
  private queue = new LocalExecutionQueue();
  private bus = new EventEmitter();

  constructor(
    private store: Store,
    private paths: AppPaths,
    private gateway: LlmGateway
  ) {
    this.bus.setMaxListeners(100);
  }

  subscribe(executionId: string, listener: (event: ExecutionEvent) => void): () => void {
    const handler = (event: ExecutionEvent) => {
      if (event.executionId === executionId) listener(event);
    };
    this.bus.on("event", handler);
    return () => this.bus.off("event", handler);
  }

  private emit(event: ExecutionEvent): void {
    this.bus.emit("event", event);
  }

  async start(input: {
    versionId: string;
    parameterValues: Record<string, unknown>;
    actor: string;
    triggerType?: Execution["triggerType"];
    rerunOfExecutionId?: string | null;
  }): Promise<Execution> {
    const version = this.store.getVersion(input.versionId);
    const workflow = this.store.getWorkflow(version.workflowId);

    const execution = this.store.createExecution({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      versionStatusAtRun: version.status,
      triggerType: input.triggerType ?? "manual",
      rerunOfExecutionId: input.rerunOfExecutionId ?? null,
      parameterValues: input.parameterValues,
      createdBy: input.actor
    });

    await this.queue.enqueue({
      executionId: execution.id,
      run: async (signal) => {
        const startedAt = nowIso();
        const runtime = new ApiNodeRuntime({
          store: this.store,
          paths: this.paths,
          gateway: this.gateway,
          actor: input.actor,
          sourceWorkflowId: workflow.id,
          sourceWorkflowName: workflow.name,
          sourceExecutionId: execution.id,
          executedAt: startedAt
        });
        this.store.updateExecution(execution.id, { status: "running", startedAt });
        this.emit({ type: "execution", executionId: execution.id, data: { status: "running", startedAt } });
        try {
          const result = await executeWorkflow({
            executionId: execution.id,
            graph: version.graph,
            parameterDefinitions: version.parameters,
            runtimeParameterValues: input.parameterValues as never,
            runtime,
            signal,
            events: {
              onNodeStart: (r) => this.persistNode(execution.id, r),
              onNodeFinish: (r) => this.persistNode(execution.id, r)
            }
          });
          const outputIds = result.finalOutputs
            .map((o) => o.data.datasetVersionId)
            .filter((x): x is string => !!x);
          const inputIds = [...runtime.usedInputDatasetVersions];
          // Input snapshots referenced by an execution become immutable (features/data-import.md §3).
          this.store.lockDatasetVersions(inputIds);
          this.store.updateExecution(execution.id, {
            status: result.status,
            finishedAt: result.finishedAt,
            errorSummary: result.errorSummary,
            inputDatasetVersionIds: inputIds,
            outputDatasetVersionIds: outputIds
          });
          this.emit({ type: "done", executionId: execution.id, data: { status: result.status, errorSummary: result.errorSummary } });
        } catch (e) {
          const message =
            e instanceof WorkflowValidationError
              ? e.issues.join("\n")
              : e instanceof Error
                ? e.message
                : String(e);
          this.store.updateExecution(execution.id, {
            status: signal.aborted ? "cancelled" : "failed",
            finishedAt: nowIso(),
            errorSummary: message
          });
          this.emit({ type: "done", executionId: execution.id, data: { status: signal.aborted ? "cancelled" : "failed", errorSummary: message } });
        }
      }
    });

    return this.store.getExecution(execution.id);
  }

  private persistNode(executionId: string, record: NodeRunRecord): void {
    const outputIds: Record<string, string> = {};
    for (const [handle, data] of Object.entries(record.outputs)) {
      if (data.datasetVersionId) outputIds[handle] = data.datasetVersionId;
    }
    this.store.saveNodeExecution({
      id: record.id,
      executionId,
      nodeId: record.nodeId,
      nodeType: record.nodeType,
      nodeLabel: record.nodeLabel,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      inputSummary: record.inputSummary,
      outputSummary: record.outputSummary,
      outputDatasetVersionIds: outputIds,
      error: record.error,
      logs: record.logs
    });
    this.emit({
      type: "node",
      executionId,
      data: {
        nodeId: record.nodeId,
        status: record.status,
        error: record.error,
        outputSummary: record.outputSummary,
        outputDatasetVersionIds: outputIds
      }
    });
  }

  async cancel(executionId: string): Promise<void> {
    await this.queue.cancel(executionId);
  }

  async waitFor(executionId: string, timeoutMs = 120000): Promise<string | undefined> {
    return this.queue.waitFor(executionId, timeoutMs);
  }

  async rerun(executionId: string, actor: string): Promise<Execution> {
    const original = this.store.getExecution(executionId);
    // Rerun requires the same inputs to still exist (features/run-history.md §2.3).
    for (const id of original.inputDatasetVersionIds) {
      try {
        this.store.getDatasetVersion(id);
      } catch {
        throw new StoreError("Rerun is blocked: one or more input datasets from the original run no longer exist.", 409);
      }
    }
    return this.start({
      versionId: original.workflowVersionId,
      parameterValues: original.parameterValues,
      actor,
      triggerType: "rerun",
      rerunOfExecutionId: original.id
    });
  }

  buildEvidence(executionId: string, appVersion: string): EvidencePackage {
    const execution = this.store.getExecution(executionId);
    const version = this.store.getVersion(execution.workflowVersionId);
    const workflow = this.store.getWorkflow(execution.workflowId);
    const nodeRuns = this.store.listNodeExecutions(executionId);

    const inputs = execution.inputDatasetVersionIds.map((id) => {
      const dsv = this.store.getDatasetVersion(id);
      const ds = this.store.getDataset(dsv.datasetId);
      return { datasetVersionId: id, name: ds.name, sourceFileName: dsv.sourceFileName, contentHash: dsv.contentHash, rowCount: dsv.rowCount };
    });
    const outputs: EvidencePackage["record"] extends never ? never : { datasetVersionId: string; nodeLabel: string; handle: string; contentHash: string; rowCount: number }[] = [];
    for (const nr of nodeRuns) {
      for (const [handle, dsvId] of Object.entries(nr.outputDatasetVersionIds)) {
        if (!execution.outputDatasetVersionIds.includes(dsvId)) continue;
        const dsv = this.store.getDatasetVersion(dsvId);
        outputs.push({ datasetVersionId: dsvId, nodeLabel: nr.nodeLabel, handle, contentHash: dsv.contentHash, rowCount: dsv.rowCount });
      }
    }
    const llmCalls = this.store.listLlmCalls(executionId).map((c) => ({
      providerId: c.provider_id,
      providerType: c.provider_type,
      model: c.model,
      latencyMs: c.latency_ms,
      at: c.at
    }));

    return buildEvidencePackage({
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowVersionId: version.id,
      versionNumber: version.versionNumber,
      versionStatusAtRun: execution.versionStatusAtRun,
      runBy: execution.createdBy,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      status: execution.status,
      triggerType: execution.triggerType,
      parameterValues: execution.parameterValues,
      inputs,
      outputs,
      nodeRuns: nodeRuns.map((n) => ({
        nodeId: n.nodeId,
        nodeLabel: n.nodeLabel,
        nodeType: n.nodeType,
        status: n.status,
        error: n.error,
        outputSummary: n.outputSummary
      })),
      logs: nodeRuns.flatMap((n) => n.logs),
      errorSummary: execution.errorSummary,
      llmCalls,
      appVersion
    });
  }
}
