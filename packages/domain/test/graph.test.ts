import { describe, it, expect } from "vitest";
import { validateGraph, topologicalOrder, type WorkflowGraph } from "../src/graph.js";
import { canTransitionVersion, isVersionEditable } from "../src/enums.js";

function makeGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: "n1", type: "import_sample", label: "Import", position: { x: 0, y: 0 }, config: { sampleId: "expenses" } },
      { id: "n2", type: "filter", label: "Filter", position: { x: 200, y: 0 }, config: { expression: "{Amount} > 100", emitNonMatching: false } },
      { id: "n3", type: "sort", label: "Sort", position: { x: 400, y: 0 }, config: { keys: [{ column: "Amount", direction: "desc" }] } }
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "output", target: "n2", targetHandle: "input" },
      { id: "e2", source: "n2", sourceHandle: "matched", target: "n3", targetHandle: "input" }
    ],
    annotations: []
  };
}

describe("graph validation", () => {
  it("accepts a valid linear graph", () => {
    const r = validateGraph(makeGraph(), { forRun: true });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects edges referencing missing nodes", () => {
    const g = makeGraph();
    g.edges.push({ id: "e3", source: "n3", target: "ghost" });
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "missing_node")).toBe(true);
  });

  it("rejects unknown node types", () => {
    const g = makeGraph();
    g.nodes.push({ id: "n4", type: "teleport", position: { x: 0, y: 0 }, config: {} });
    const r = validateGraph(g);
    expect(r.errors.some((e) => e.code === "unknown_type")).toBe(true);
  });

  it("rejects invalid node config", () => {
    const g = makeGraph();
    (g.nodes[1].config as any) = {}; // filter without expression
    const r = validateGraph(g);
    expect(r.errors.some((e) => e.code === "config")).toBe(true);
  });

  it("rejects cycles", () => {
    const g = makeGraph();
    g.edges.push({ id: "e3", source: "n3", sourceHandle: "output", target: "n2", targetHandle: "input" });
    const r = validateGraph(g);
    expect(r.errors.some((e) => e.code === "cycle" || e.code === "input_cardinality")).toBe(true);
  });

  it("rejects self-loops", () => {
    const g = makeGraph();
    g.edges.push({ id: "e3", source: "n2", sourceHandle: "matched", target: "n2", targetHandle: "input" });
    const r = validateGraph(g);
    expect(r.errors.some((e) => e.code === "self_loop")).toBe(true);
  });

  it("enforces single-connection input cardinality", () => {
    const g = makeGraph();
    g.nodes.push({ id: "n4", type: "import_sample", position: { x: 0, y: 100 }, config: { sampleId: "expenses" } });
    g.edges.push({ id: "e3", source: "n4", sourceHandle: "output", target: "n2", targetHandle: "input" });
    const r = validateGraph(g);
    expect(r.errors.some((e) => e.code === "input_cardinality")).toBe(true);
  });

  it("allows multiple connections into append", () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: "a", type: "import_sample", position: { x: 0, y: 0 }, config: { sampleId: "s1" } },
        { id: "b", type: "import_sample", position: { x: 0, y: 100 }, config: { sampleId: "s2" } },
        { id: "c", type: "append", position: { x: 200, y: 50 }, config: { alignByName: true } }
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "output", target: "c", targetHandle: "input" },
        { id: "e2", source: "b", sourceHandle: "output", target: "c", targetHandle: "input" }
      ],
      annotations: []
    };
    const r = validateGraph(g, { forRun: true });
    expect(r.errors).toEqual([]);
  });

  it("run mode requires required inputs to be connected", () => {
    const g = makeGraph();
    g.edges = g.edges.slice(0, 1); // n3 sort loses its input
    const r = validateGraph(g, { forRun: true });
    expect(r.errors.some((e) => e.code === "missing_input" && e.nodeId === "n3")).toBe(true);
  });

  it("rejects invalid handles", () => {
    const g = makeGraph();
    g.edges[0].sourceHandle = "bogus";
    const r = validateGraph(g);
    expect(r.errors.some((e) => e.code === "missing_handle")).toBe(true);
  });
});

describe("topological order", () => {
  it("orders linear graphs deterministically", () => {
    const order = topologicalOrder(makeGraph());
    expect(order).toEqual(["n1", "n2", "n3"]);
  });

  it("returns null for cyclic graphs", () => {
    const g = makeGraph();
    g.edges.push({ id: "e3", source: "n3", target: "n1" });
    expect(topologicalOrder(g)).toBeNull();
  });
});

describe("version status rules", () => {
  it("allows the documented transitions", () => {
    expect(canTransitionVersion("draft", "in_review")).toBe(true);
    expect(canTransitionVersion("in_review", "verified")).toBe(true);
    expect(canTransitionVersion("in_review", "draft")).toBe(true);
    expect(canTransitionVersion("verified", "active")).toBe(true);
    expect(canTransitionVersion("active", "superseded")).toBe(true);
  });

  it("blocks forbidden transitions", () => {
    expect(canTransitionVersion("active", "draft")).toBe(false);
    expect(canTransitionVersion("verified", "draft")).toBe(false);
    expect(canTransitionVersion("draft", "active")).toBe(false);
    expect(canTransitionVersion("rejected", "active")).toBe(false);
  });

  it("only drafts are editable", () => {
    expect(isVersionEditable("draft")).toBe(true);
    expect(isVersionEditable("verified")).toBe(false);
    expect(isVersionEditable("active")).toBe(false);
    expect(isVersionEditable("in_review")).toBe(false);
  });
});
