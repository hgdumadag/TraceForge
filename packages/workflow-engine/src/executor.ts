/**
 * Workflow execution engine (features/workflow-execution.md).
 * Storage- and runtime-agnostic: node behavior is injected through NodeRuntime,
 * persistence through ExecutionEvents. The engine never touches React, HTTP,
 * or the database (project.md §9).
 */
import {
  validateGraph,
  topologicalOrder,
  resolveParameters,
  getNodeType,
  newId,
  nowIso,
  type WorkflowGraph,
  type WorkflowNode,
  type ParameterDefinition,
  type ParameterValues,
  type NodeExecutionStatus,
  type ExecutionStatus
} from "@traceforge/domain";

/** Data flowing across an edge: a materialized dataset snapshot reference. */
export interface PortData {
  datasetVersionId?: string;
  path: string;
  columns: { name: string; type: string }[];
  rowCount: number;
  contentHash?: string;
}

export interface NodeExecuteRequest {
  node: WorkflowNode;
  /** input handle -> upstream outputs in edge order. */
  inputs: Record<string, PortData[]>;
  parameterDefinitions: ParameterDefinition[];
  parameterValues: ParameterValues;
  executionId: string;
  signal?: AbortSignal;
}

export interface NodeExecuteResult {
  /** output handle -> produced dataset snapshot. */
  outputs: Record<string, PortData>;
  logs?: string[];
  summary?: Record<string, unknown>;
}

export interface NodeRuntime {
  execute(req: NodeExecuteRequest): Promise<NodeExecuteResult>;
}

export interface NodeRunRecord {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: NodeExecutionStatus;
  startedAt: string | null;
  finishedAt: string | null;
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  outputs: Record<string, PortData>;
  error: string | null;
  logs: string[];
}

export interface ExecutionEvents {
  onNodeStart?(record: NodeRunRecord): void | Promise<void>;
  onNodeFinish?(record: NodeRunRecord): void | Promise<void>;
  onLog?(nodeId: string | null, message: string): void | Promise<void>;
}

export interface ExecuteWorkflowOptions {
  executionId?: string;
  graph: WorkflowGraph;
  parameterDefinitions: ParameterDefinition[];
  runtimeParameterValues: ParameterValues;
  runtime: NodeRuntime;
  events?: ExecutionEvents;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string;
  parameterValues: ParameterValues;
  nodeRuns: NodeRunRecord[];
  errorSummary: string | null;
  /** Terminal outputs: dataset snapshots produced by nodes with no outgoing edges. */
  finalOutputs: { nodeId: string; nodeLabel: string; handle: string; data: PortData }[];
}

export class WorkflowValidationError extends Error {
  constructor(public issues: string[]) {
    super(`Workflow validation failed:\n${issues.join("\n")}`);
    this.name = "WorkflowValidationError";
  }
}

export async function executeWorkflow(opts: ExecuteWorkflowOptions): Promise<ExecutionResult> {
  const executionId = opts.executionId ?? newId("exec");
  const startedAt = nowIso();

  // 1. Validate structure + configs.
  const validation = validateGraph(opts.graph, { parameters: opts.parameterDefinitions, forRun: true });
  if (!validation.ok) {
    throw new WorkflowValidationError(validation.errors.map((e) => e.message));
  }

  // 2. Resolve parameters deterministically.
  const resolution = resolveParameters(opts.parameterDefinitions, opts.runtimeParameterValues);
  if (!resolution.ok) {
    throw new WorkflowValidationError(resolution.errors);
  }

  // 3. Plan.
  const order = topologicalOrder(opts.graph);
  if (!order) throw new WorkflowValidationError(["Workflow contains a cycle."]);
  const nodesById = new Map(opts.graph.nodes.map((n) => [n.id, n]));

  const nodeRuns = new Map<string, NodeRunRecord>();
  for (const node of opts.graph.nodes) {
    nodeRuns.set(node.id, {
      id: newId("nrun"),
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: node.label ?? getNodeType(node.type)?.label ?? node.type,
      status: "pending",
      startedAt: null,
      finishedAt: null,
      inputSummary: {},
      outputSummary: {},
      outputs: {},
      error: null,
      logs: []
    });
  }

  const outputsByNode = new Map<string, Record<string, PortData>>();
  let failed = false;
  let cancelled = false;
  let errorSummary: string | null = null;

  const downstreamOf = (nodeId: string): Set<string> => {
    const result = new Set<string>();
    const stack = [nodeId];
    while (stack.length) {
      const current = stack.pop()!;
      for (const e of opts.graph.edges) {
        if (e.source === current && !result.has(e.target)) {
          result.add(e.target);
          stack.push(e.target);
        }
      }
    }
    return result;
  };

  for (const nodeId of order) {
    const node = nodesById.get(nodeId)!;
    const record = nodeRuns.get(nodeId)!;
    if (record.status === "skipped" || record.status === "cancelled") continue;

    if (opts.signal?.aborted) {
      cancelled = true;
      record.status = "cancelled";
      record.finishedAt = nowIso();
      await opts.events?.onNodeFinish?.(record);
      continue;
    }

    // Gather inputs from incoming edges (edge order preserved).
    const def = getNodeType(node.type)!;
    const inputs: Record<string, PortData[]> = {};
    let upstreamFailed = false;
    for (const edge of opts.graph.edges) {
      if (edge.target !== nodeId) continue;
      const handle = edge.targetHandle ?? def.inputs[0]?.name ?? "input";
      const sourceOutputs = outputsByNode.get(edge.source);
      const sourceDef = getNodeType(nodesById.get(edge.source)!.type);
      const sourceHandle = edge.sourceHandle ?? sourceDef?.outputs[0]?.name ?? "output";
      const data = sourceOutputs?.[sourceHandle];
      if (!data) {
        upstreamFailed = true;
        break;
      }
      (inputs[handle] ??= []).push(data);
    }
    if (upstreamFailed) {
      record.status = "skipped";
      record.error = "Skipped because an upstream node did not produce output.";
      record.finishedAt = nowIso();
      await opts.events?.onNodeFinish?.(record);
      continue;
    }

    record.status = "running";
    record.startedAt = nowIso();
    record.inputSummary = Object.fromEntries(
      Object.entries(inputs).map(([h, list]) => [h, list.map((d) => ({ rows: d.rowCount, columns: d.columns.length }))])
    );
    await opts.events?.onNodeStart?.(record);

    try {
      const result = await opts.runtime.execute({
        node,
        inputs,
        parameterDefinitions: opts.parameterDefinitions,
        parameterValues: resolution.values,
        executionId,
        signal: opts.signal
      });
      record.outputs = result.outputs;
      record.logs = result.logs ?? [];
      record.outputSummary = {
        ...(result.summary ?? {}),
        ...Object.fromEntries(
          Object.entries(result.outputs).map(([h, d]) => [h, { rows: d.rowCount, columns: d.columns.length }])
        )
      };
      record.status = "succeeded";
      record.finishedAt = nowIso();
      outputsByNode.set(nodeId, result.outputs);
      await opts.events?.onNodeFinish?.(record);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      record.status = opts.signal?.aborted ? "cancelled" : "failed";
      record.error = message;
      record.finishedAt = nowIso();
      await opts.events?.onNodeFinish?.(record);
      if (opts.signal?.aborted) {
        cancelled = true;
      } else {
        failed = true;
        errorSummary = `${record.nodeLabel}: ${message}`;
      }
      // Errors stop downstream execution (MVP has no continue-on-error).
      for (const dsId of downstreamOf(nodeId)) {
        const ds = nodeRuns.get(dsId)!;
        if (ds.status === "pending") {
          ds.status = "skipped";
          ds.error = `Skipped because "${record.nodeLabel}" ${cancelled ? "was cancelled" : "failed"}.`;
          ds.finishedAt = nowIso();
          await opts.events?.onNodeFinish?.(ds);
        }
      }
    }
  }

  // Terminal outputs = outputs of nodes with no outgoing edges.
  const sourcesWithEdges = new Set(opts.graph.edges.map((e) => e.source));
  const finalOutputs: ExecutionResult["finalOutputs"] = [];
  for (const [nodeId, outputs] of outputsByNode) {
    if (sourcesWithEdges.has(nodeId)) continue;
    const record = nodeRuns.get(nodeId)!;
    for (const [handle, data] of Object.entries(outputs)) {
      finalOutputs.push({ nodeId, nodeLabel: record.nodeLabel, handle, data });
    }
  }

  const status: ExecutionStatus = cancelled ? "cancelled" : failed ? "failed" : "succeeded";
  return {
    executionId,
    status,
    startedAt,
    finishedAt: nowIso(),
    parameterValues: resolution.values,
    nodeRuns: [...nodeRuns.values()],
    errorSummary,
    finalOutputs
  };
}
