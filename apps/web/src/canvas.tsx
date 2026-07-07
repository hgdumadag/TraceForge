/** Visual workflow canvas (features/canvas-builder.md) built on React Flow. */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeChange,
  type EdgeChange
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_TYPES, getNodeType, newId } from "@traceforge/domain";

export interface CanvasGraph {
  nodes: { id: string; type: string; label?: string; position: { x: number; y: number }; config: any; ui?: any }[];
  edges: { id: string; source: string; sourceHandle?: string; target: string; targetHandle?: string }[];
  annotations: { id: string; kind: "note" | "group"; text?: string; position: { x: number; y: number }; size?: { width: number; height: number } }[];
}

function TfNode({ data, selected }: any) {
  const def = getNodeType(data.nodeType);
  const inputs = def?.inputs ?? [];
  const outputs = def?.outputs ?? [];
  return (
    <div className={`tf-node status-${data.status ?? "idle"} ${selected ? "selected" : ""}`}>
      {inputs.map((p, i) => (
        <Handle
          key={p.name}
          type="target"
          id={p.name}
          position={Position.Left}
          style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%`, background: "var(--accent)" }}
          title={p.name}
        />
      ))}
      <div className="type">{def?.category} · {def?.label}</div>
      <div style={{ fontWeight: 600 }}>{data.label}</div>
      {inputs.length > 1 && (
        <div className="small dim">{inputs.map((p) => p.name).join(" | ")}</div>
      )}
      {data.status && data.status !== "idle" && <div className={`badge ${data.status}`} style={{ marginTop: 4 }}>{data.status}</div>}
      {outputs.map((p, i) => (
        <Handle
          key={p.name}
          type="source"
          id={p.name}
          position={Position.Right}
          style={{ top: `${((i + 1) / (outputs.length + 1)) * 100}%`, background: "var(--green)" }}
          title={p.name}
        />
      ))}
      {outputs.length > 1 && (
        <div className="small dim" style={{ textAlign: "right" }}>{outputs.map((p) => p.name).join(" | ")}</div>
      )}
    </div>
  );
}

function TfNote({ data }: any) {
  return <div className="tf-note">{data.text || "(empty note)"}</div>;
}

const nodeTypes = { tfNode: TfNode, tfNote: TfNote };

export function toRfGraph(graph: CanvasGraph, statuses: Record<string, string>): { nodes: RFNode[]; edges: RFEdge[] } {
  const nodes: RFNode[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "tfNode",
    position: n.position,
    data: { label: n.label ?? getNodeType(n.type)?.label ?? n.type, nodeType: n.type, config: n.config, status: statuses[n.id] }
  }));
  for (const a of graph.annotations ?? []) {
    nodes.push({ id: `ann_${a.id}`, type: "tfNote", position: a.position, data: { text: a.text ?? "" } });
  }
  const edges: RFEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: false,
    style: { stroke: "var(--border)" }
  }));
  return { nodes, edges };
}

export function fromRfGraph(nodes: RFNode[], edges: RFEdge[]): CanvasGraph {
  const graph: CanvasGraph = { nodes: [], edges: [], annotations: [] };
  for (const n of nodes) {
    if (n.type === "tfNote") {
      graph.annotations.push({ id: n.id.replace(/^ann_/, ""), kind: "note", text: (n.data as any).text, position: n.position });
    } else {
      graph.nodes.push({
        id: n.id,
        type: (n.data as any).nodeType,
        label: (n.data as any).label,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        config: (n.data as any).config ?? {}
      });
    }
  }
  for (const e of edges) {
    graph.edges.push({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? undefined,
      target: e.target,
      targetHandle: e.targetHandle ?? undefined
    });
  }
  return graph;
}

export function Palette({ onAdd, readOnly }: { onAdd: (type: string) => void; readOnly: boolean }) {
  const [search, setSearch] = useState("");
  const groups = useMemo(() => {
    const filtered = NODE_TYPES.filter(
      (t) => !search || t.label.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase())
    );
    const byCat = new Map<string, typeof NODE_TYPES>();
    for (const t of filtered) {
      byCat.set(t.category, [...(byCat.get(t.category) ?? []), t] as never);
    }
    return byCat;
  }, [search]);

  return (
    <div className="palette">
      <input placeholder="Search tools…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%" }} />
      {[...groups.entries()].map(([cat, types]) => (
        <div key={cat}>
          <h4>{cat}</h4>
          {types.map((t) => (
            <div
              key={t.type}
              className="palette-item"
              title={t.description}
              onClick={() => !readOnly && onAdd(t.type)}
              style={readOnly ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              {t.label}
              {t.requiresNetwork ? " 🌐" : ""}
            </div>
          ))}
        </div>
      ))}
      <h4>Canvas</h4>
      <div className="palette-item" onClick={() => !readOnly && onAdd("__note")} style={readOnly ? { opacity: 0.5 } : undefined}>
        Sticky note
      </div>
    </div>
  );
}

export function FlowCanvas({
  rfNodes,
  rfEdges,
  setRfNodes,
  setRfEdges,
  onSelect,
  onDirty,
  readOnly
}: {
  rfNodes: RFNode[];
  rfEdges: RFEdge[];
  setRfNodes: (updater: (nodes: RFNode[]) => RFNode[]) => void;
  setRfEdges: (updater: (edges: RFEdge[]) => RFEdge[]) => void;
  onSelect: (nodeId: string | null) => void;
  onDirty: () => void;
  readOnly: boolean;
}) {
  const [connectError, setConnectError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>();

  const showError = (msg: string) => {
    setConnectError(msg);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setConnectError(null), 4000);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nodes) => applyNodeChanges(changes, nodes));
      if (changes.some((c) => c.type === "position" || c.type === "remove")) onDirty();
    },
    [setRfNodes, onDirty]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((edges) => applyEdgeChanges(changes, edges));
      if (changes.some((c) => c.type === "remove")) onDirty();
    },
    [setRfEdges, onDirty]
  );

  const isValidConnection = useCallback(
    (conn: RFEdge | Connection): boolean => {
      if (!conn.source || !conn.target) return false;
      if (conn.source === conn.target) return false;
      return true;
    },
    []
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (readOnly) return;
      setRfEdges((edges) => {
        // Enforce input cardinality client-side for immediate feedback.
        const targetNode = rfNodes.find((n) => n.id === conn.target);
        const def = targetNode ? getNodeType((targetNode.data as any).nodeType) : undefined;
        const port = def?.inputs.find((p) => p.name === (conn.targetHandle ?? def?.inputs[0]?.name));
        if (port && !port.multi) {
          const existing = edges.filter((e) => e.target === conn.target && (e.targetHandle ?? def?.inputs[0]?.name) === port.name);
          if (existing.length > 0) {
            showError(`Input "${port.name}" already has a connection. Remove it first.`);
            return edges;
          }
        }
        onDirty();
        return addEdge({ ...conn, id: newId("edge") }, edges);
      });
    },
    [readOnly, rfNodes, setRfEdges, onDirty]
  );

  return (
    <div className="canvas-area">
      {connectError && (
        <div className="error-box" style={{ position: "absolute", top: 8, left: 8, zIndex: 20 }}>{connectError}</div>
      )}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onSelectionChange={(sel) => onSelect(sel.nodes[0]?.id ?? null)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={18} color="#232b34" />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "var(--bg-panel)" }} />
      </ReactFlow>
    </div>
  );
}
