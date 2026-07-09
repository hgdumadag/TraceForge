/**
 * Workflow graph schema + validation (features/canvas-builder.md §3–4,
 * features/workflow-execution.md §4).
 */
import { z } from "zod";
import { getNodeType, validateNodeConfig } from "./nodes.js";
import { ParameterDefinitionListSchema, type ParameterDefinition } from "./parameters.js";

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.unknown()).default({}),
  ui: z.object({ width: z.number().optional(), height: z.number().optional() }).optional()
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().optional(),
  target: z.string().min(1),
  targetHandle: z.string().optional()
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const CanvasAnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["note", "group"]),
  text: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  color: z.string().optional(),
  fontSize: z.number().min(10).max(28).optional()
});
export type CanvasAnnotation = z.infer<typeof CanvasAnnotationSchema>;

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  annotations: z.array(CanvasAnnotationSchema).default([])
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export interface GraphValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphValidationResult {
  ok: boolean;
  errors: GraphValidationIssue[];
}

/**
 * Structural validation used before save and before run:
 * schema shape, unique ids, known node types, valid configs, edge endpoint +
 * handle existence, input cardinality, no cycles (MVP is DAG-only), and
 * required inputs connected (run mode only).
 */
export function validateGraph(
  graph: unknown,
  opts: { parameters?: ParameterDefinition[]; forRun?: boolean } = {}
): GraphValidationResult {
  const errors: GraphValidationIssue[] = [];
  const parsed = WorkflowGraphSchema.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: "schema",
        message: `Workflow structure is invalid: ${i.path.join(".")} — ${i.message}`
      }))
    };
  }
  const { nodes, edges } = parsed.data;

  if (opts.parameters) {
    const p = ParameterDefinitionListSchema.safeParse(opts.parameters);
    if (!p.success) {
      for (const i of p.error.issues) errors.push({ code: "parameters", message: i.message });
    }
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ code: "duplicate_node", nodeId: node.id, message: `Duplicate node id "${node.id}".` });
    }
    nodeIds.add(node.id);
    const def = getNodeType(node.type);
    if (!def) {
      errors.push({ code: "unknown_type", nodeId: node.id, message: `Node "${node.label ?? node.id}" has unknown type "${node.type}".` });
      continue;
    }
    const cfg = validateNodeConfig(node.type, node.config);
    if (!cfg.ok) {
      for (const msg of cfg.errors) {
        errors.push({ code: "config", nodeId: node.id, message: `${node.label ?? def.label}: ${msg}` });
      }
    }
  }

  const edgeIds = new Set<string>();
  const incoming = new Map<string, Map<string, number>>(); // nodeId -> handle -> count
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({ code: "duplicate_edge", edgeId: edge.id, message: `Duplicate edge id "${edge.id}".` });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      errors.push({ code: "missing_node", edgeId: edge.id, message: `Edge "${edge.id}" references missing source node "${edge.source}".` });
      continue;
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ code: "missing_node", edgeId: edge.id, message: `Edge "${edge.id}" references missing target node "${edge.target}".` });
      continue;
    }
    if (edge.source === edge.target) {
      errors.push({ code: "self_loop", edgeId: edge.id, message: `Node cannot connect to itself.` });
      continue;
    }
    const sourceNode = nodes.find((n) => n.id === edge.source)!;
    const targetNode = nodes.find((n) => n.id === edge.target)!;
    const sourceDef = getNodeType(sourceNode.type);
    const targetDef = getNodeType(targetNode.type);
    if (sourceDef) {
      const handle = edge.sourceHandle ?? sourceDef.outputs[0]?.name;
      if (!sourceDef.outputs.some((o) => o.name === handle)) {
        errors.push({ code: "missing_handle", edgeId: edge.id, message: `Node "${sourceNode.label ?? sourceNode.id}" has no output "${handle}".` });
      }
    }
    if (targetDef) {
      const handle = edge.targetHandle ?? targetDef.inputs[0]?.name;
      const port = targetDef.inputs.find((p) => p.name === handle);
      if (!port) {
        errors.push({ code: "missing_handle", edgeId: edge.id, message: `Node "${targetNode.label ?? targetNode.id}" has no input "${handle}".` });
      } else {
        const byHandle = incoming.get(edge.target) ?? new Map<string, number>();
        const count = (byHandle.get(port.name) ?? 0) + 1;
        byHandle.set(port.name, count);
        incoming.set(edge.target, byHandle);
        if (!port.multi && count > 1) {
          errors.push({
            code: "input_cardinality",
            edgeId: edge.id,
            message: `Input "${port.name}" of node "${targetNode.label ?? targetNode.id}" accepts only one connection.`
          });
        }
      }
    }
  }

  // Cycle detection (Kahn's algorithm). MVP workflows are DAGs.
  const order = topologicalOrder(parsed.data);
  if (order === null) {
    errors.push({ code: "cycle", message: "Workflow contains a cycle. Workflows must flow in one direction." });
  }

  if (opts.forRun) {
    for (const node of nodes) {
      const def = getNodeType(node.type);
      if (!def) continue;
      for (const port of def.inputs) {
        if (port.required && !(incoming.get(node.id)?.get(port.name) ?? 0)) {
          errors.push({
            code: "missing_input",
            nodeId: node.id,
            message: `Node "${node.label ?? def.label}" is missing a connection to its "${port.name}" input.`
          });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Topological order of node ids, or null when the graph has a cycle. */
export function topologicalOrder(graph: Pick<WorkflowGraph, "nodes" | "edges">): string[] | null {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue;
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    adjacency.get(e.source)!.push(e.target);
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  // Keep deterministic order: stable by original node order.
  const nodeOrder = new Map(graph.nodes.map((n, i) => [n.id, i]));
  queue.sort((a, b) => (nodeOrder.get(a)! - nodeOrder.get(b)!));
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) {
        queue.push(next);
        queue.sort((a, b) => (nodeOrder.get(a)! - nodeOrder.get(b)!));
      }
    }
  }
  return result.length === graph.nodes.length ? result : null;
}
