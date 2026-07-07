import { describe, it, expect } from "vitest";
import {
  executeWorkflow,
  WorkflowValidationError,
  LocalExecutionQueue,
  type NodeRuntime,
  type NodeExecuteRequest,
  type PortData
} from "../src/index.js";
import type { WorkflowGraph, ParameterDefinition } from "@traceforge/domain";

/** Fake runtime: records execution order; import nodes emit data, transforms pass it through. */
function fakeRuntime(opts: { failOn?: string; delayMs?: number } = {}) {
  const executed: string[] = [];
  const data = (rows: number): PortData => ({ path: `/fake/${rows}.parquet`, columns: [{ name: "A", type: "text" }], rowCount: rows });
  const runtime: NodeRuntime = {
    async execute(req: NodeExecuteRequest) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (req.signal?.aborted) throw new Error("aborted");
      executed.push(req.node.id);
      if (opts.failOn === req.node.id) throw new Error(`boom in ${req.node.id}`);
      const def = req.node.type;
      if (def === "import_sample") return { outputs: { output: data(10) } };
      if (def === "filter") {
        const input = req.inputs["input"]?.[0];
        return { outputs: { matched: data((input?.rowCount ?? 0) - 1), unmatched: data(1) } };
      }
      if (def === "join") {
        return { outputs: { output: data((req.inputs["left"]?.[0]?.rowCount ?? 0) + (req.inputs["right"]?.[0]?.rowCount ?? 0)) } };
      }
      if (def === "append") {
        const total = (req.inputs["input"] ?? []).reduce((s, d) => s + d.rowCount, 0);
        return { outputs: { output: data(total) } };
      }
      return { outputs: { output: req.inputs["input"]?.[0] ?? data(0) } };
    }
  };
  return { runtime, executed };
}

const params: ParameterDefinition[] = [
  { key: "threshold", label: "Threshold", type: "decimal", required: true, defaultValue: 100 }
];

function linearGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: "imp", type: "import_sample", label: "Import", position: { x: 0, y: 0 }, config: { sampleId: "s" } },
      { id: "flt", type: "filter", label: "Filter", position: { x: 1, y: 0 }, config: { expression: "{A} != null", emitNonMatching: false } },
      { id: "srt", type: "sort", label: "Sort", position: { x: 2, y: 0 }, config: { keys: [{ column: "A", direction: "asc" }] } }
    ],
    edges: [
      { id: "e1", source: "imp", sourceHandle: "output", target: "flt", targetHandle: "input" },
      { id: "e2", source: "flt", sourceHandle: "matched", target: "srt", targetHandle: "input" }
    ],
    annotations: []
  };
}

describe("executeWorkflow", () => {
  it("runs a linear workflow in dependency order and captures parameters", async () => {
    const { runtime, executed } = fakeRuntime();
    const result = await executeWorkflow({
      graph: linearGraph(),
      parameterDefinitions: params,
      runtimeParameterValues: { threshold: 50 },
      runtime
    });
    expect(executed).toEqual(["imp", "flt", "srt"]);
    expect(result.status).toBe("succeeded");
    expect(result.parameterValues.threshold).toBe(50);
    expect(result.nodeRuns.every((r) => r.status === "succeeded")).toBe(true);
    expect(result.finalOutputs.length).toBe(1);
    expect(result.finalOutputs[0].nodeId).toBe("srt");
  });

  it("fan-out branches run after shared input; join waits for both inputs", async () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: "a", type: "import_sample", position: { x: 0, y: 0 }, config: { sampleId: "s" } },
        { id: "b", type: "sort", position: { x: 1, y: 0 }, config: { keys: [{ column: "A", direction: "asc" }] } },
        { id: "c", type: "sample", position: { x: 1, y: 1 }, config: { mode: "first", rows: 5 } },
        { id: "j", type: "join", position: { x: 2, y: 0 }, config: { joinType: "inner", keys: [{ left: "A", right: "A" }], rightSuffix: "_r" } }
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "output", target: "b", targetHandle: "input" },
        { id: "e2", source: "a", sourceHandle: "output", target: "c", targetHandle: "input" },
        { id: "e3", source: "b", sourceHandle: "output", target: "j", targetHandle: "left" },
        { id: "e4", source: "c", sourceHandle: "output", target: "j", targetHandle: "right" }
      ],
      annotations: []
    };
    const { runtime, executed } = fakeRuntime();
    const result = await executeWorkflow({
      graph,
      parameterDefinitions: [],
      runtimeParameterValues: {},
      runtime
    });
    expect(result.status).toBe("succeeded");
    expect(executed[0]).toBe("a");
    expect(executed.indexOf("j")).toBe(3);
    expect(result.finalOutputs[0].data.rowCount).toBe(20);
  });

  it("invalid graph blocks the run before any node executes", async () => {
    const graph = linearGraph();
    graph.edges.push({ id: "bad", source: "srt", target: "ghost" });
    const { runtime, executed } = fakeRuntime();
    await expect(
      executeWorkflow({ graph, parameterDefinitions: [], runtimeParameterValues: {}, runtime })
    ).rejects.toThrow(WorkflowValidationError);
    expect(executed).toEqual([]);
  });

  it("missing required parameter blocks the run", async () => {
    const { runtime } = fakeRuntime();
    await expect(
      executeWorkflow({
        graph: linearGraph(),
        parameterDefinitions: [{ key: "must", label: "Must", type: "text", required: true }],
        runtimeParameterValues: {},
        runtime
      })
    ).rejects.toThrow(/missing a value/);
  });

  it("failed node marks execution failed and skips downstream nodes", async () => {
    const { runtime } = fakeRuntime({ failOn: "flt" });
    const result = await executeWorkflow({
      graph: linearGraph(),
      parameterDefinitions: params,
      runtimeParameterValues: {},
      runtime
    });
    expect(result.status).toBe("failed");
    expect(result.errorSummary).toMatch(/boom in flt/);
    const byId = Object.fromEntries(result.nodeRuns.map((r) => [r.nodeId, r]));
    expect(byId.imp.status).toBe("succeeded");
    expect(byId.flt.status).toBe("failed");
    expect(byId.srt.status).toBe("skipped");
    expect(byId.srt.error).toMatch(/failed/);
  });

  it("emits node lifecycle events", async () => {
    const { runtime } = fakeRuntime();
    const events: string[] = [];
    await executeWorkflow({
      graph: linearGraph(),
      parameterDefinitions: params,
      runtimeParameterValues: {},
      runtime,
      events: {
        onNodeStart: (r) => void events.push(`start:${r.nodeId}`),
        onNodeFinish: (r) => void events.push(`finish:${r.nodeId}:${r.status}`)
      }
    });
    expect(events).toEqual([
      "start:imp", "finish:imp:succeeded",
      "start:flt", "finish:flt:succeeded",
      "start:srt", "finish:srt:succeeded"
    ]);
  });

  it("cancellation marks execution cancelled", async () => {
    const { runtime } = fakeRuntime({ delayMs: 30 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 40);
    const result = await executeWorkflow({
      graph: linearGraph(),
      parameterDefinitions: params,
      runtimeParameterValues: {},
      runtime,
      signal: controller.signal
    });
    expect(result.status).toBe("cancelled");
    expect(result.nodeRuns.some((r) => r.status === "cancelled")).toBe(true);
  });
});

describe("LocalExecutionQueue", () => {
  it("runs jobs sequentially and reports status transitions", async () => {
    const queue = new LocalExecutionQueue();
    const order: string[] = [];
    await queue.enqueue({ executionId: "e1", run: async () => { order.push("e1"); } });
    await queue.enqueue({ executionId: "e2", run: async () => { order.push("e2"); } });
    expect(await queue.waitFor("e1")).toBe("succeeded");
    expect(await queue.waitFor("e2")).toBe("succeeded");
    expect(order).toEqual(["e1", "e2"]);
  });

  it("marks failing jobs failed", async () => {
    const queue = new LocalExecutionQueue();
    await queue.enqueue({ executionId: "bad", run: async () => { throw new Error("x"); } });
    expect(await queue.waitFor("bad")).toBe("failed");
  });

  it("cancels queued jobs before they start", async () => {
    const queue = new LocalExecutionQueue();
    await queue.enqueue({ executionId: "slow", run: () => new Promise((r) => setTimeout(r, 100)) });
    await queue.enqueue({ executionId: "victim", run: async () => {} });
    await queue.cancel("victim");
    expect(await queue.waitFor("victim")).toBe("cancelled");
  });

  it("aborts running jobs through the signal", async () => {
    const queue = new LocalExecutionQueue();
    await queue.enqueue({
      executionId: "runner",
      run: (signal) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        })
    });
    await new Promise((r) => setTimeout(r, 30));
    await queue.cancel("runner");
    expect(await queue.waitFor("runner")).toBe("cancelled");
  });
});
