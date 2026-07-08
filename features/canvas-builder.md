# Feature Specification: Canvas Builder

## What this file is for

This file defines the visual workflow canvas where users arrange nodes, connect them, add notes/groups, and design audit analytics flows.

## When to read this file

Read this file when building or changing:

- Node-and-edge canvas behavior.
- Drag/drop node placement.
- Edge creation and validation.
- Zoom, pan, minimap, selection, delete, copy/paste.
- Group/section boxes and notes.
- Canvas persistence in workflow version JSON.

## When not to read this file

Do not read this file for individual node execution logic, expression evaluation internals, or verification review behavior.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. The canvas is an editor for workflow structure; execution behavior belongs in `workflow-execution.md`.
2. Save enough layout data to reopen workflows exactly as the user left them.
3. Prevent invalid edges where possible, but do not silently delete user work.
4. Keep large workflows navigable through zoom, minimap, and clear node labels.
5. Add tests for schema persistence, edge validation, and canvas interactions.

---

# 1. Feature summary

The canvas lets users visually compose audit workflows. It should support the design style seen in audit automation tools: an import node feeding multiple transformation/validation branches, grouped by audit objective, with note cards explaining each test.

# 2. MVP user stories

## 2.1 Add nodes

Acceptance criteria:

- User can add a node from a searchable tool palette.
- Node appears at a sensible location on canvas.
- Node has a name, icon, type, input handles, output handles, and status indicator.
- Node is saved into the draft workflow version.

## 2.2 Connect nodes

Acceptance criteria:

- User can drag an edge from an output handle to an input handle.
- Edges persist in workflow JSON.
- Invalid connections are blocked with a clear message.
- Multiple branches from one node are supported.
- Fan-in to join/append/merge nodes is supported where the node type allows it.

## 2.3 Move, select, and edit layout

Acceptance criteria:

- User can drag nodes.
- User can multi-select nodes and edges.
- User can delete selected draft nodes with confirmation when deletion affects downstream nodes.
- User can copy/paste nodes within a draft workflow.
- Layout changes auto-save or clearly show unsaved status.

## 2.4 Add notes and groups

Acceptance criteria:

- User can add note cards explaining audit purpose, criteria, or test rationale.
- Note text is directly editable in place on the canvas (click into the note and type); editing is disabled on read-only (non-draft) versions.
- Notes are resizable by dragging their selection handles; the resized size is saved with the note.
- User can add group/section boxes around related nodes.
- Notes and groups persist in version JSON, including note size.
- Notes and groups do not execute.

## 2.5 Navigate canvas

Acceptance criteria:

- User can zoom, pan, fit-to-screen, and use minimap.
- Canvas remains usable for at least 100 nodes in MVP testing.

## 2.6 Maximize canvas space

Acceptance criteria:

- Entering the workflow editor (opening a workflow, whether newly created blank, cloned from a template/toolkit, or AI-drafted) automatically collapses the main navigation sidebar to give the canvas more room.
- The sidebar has a toggle so the user can re-expand or collapse it manually at any time.
- A manual expand is respected while editing: the app does not re-collapse the sidebar until the user enters a workflow editor view again (e.g. opens another workflow).
- The right-hand Inspector panel defaults to collapsed when no node is selected (nothing to configure) and automatically expands the moment a node is selected. It has its own toggle so the user can collapse or expand it manually at any time; a manual collapse persists until a different node is selected or the selection is cleared. Collapsing does not discard unsaved edits in the currently open node's configuration — the panel stays mounted, just hidden.

# 3. Canvas JSON shape

Minimum fields:

```json
{
  "nodes": [
    {
      "id": "node_1",
      "type": "filter",
      "label": "Filter",
      "position": { "x": 100, "y": 200 },
      "config": {},
      "ui": { "width": 220, "height": 120 }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_1",
      "sourceHandle": "output",
      "target": "node_2",
      "targetHandle": "input"
    }
  ],
  "annotations": []
}
```

# 4. Edge validation rules

- Source and target nodes must exist.
- Source handle and target handle must exist.
- A node cannot connect to itself unless the node type explicitly supports loops. MVP should not support cycles.
- Target input cardinality must be respected.
- Dataset-output handles can connect only to dataset-input handles unless an adapter exists.

# 5. Data model touchpoints

- `WorkflowVersion.nodes`
- `WorkflowVersion.edges`
- `WorkflowVersion.canvasAnnotations`
- `NodeTypeRegistry`

# 6. Tests

Minimum tests:

- Add node persists in version JSON.
- Move node persists position.
- Valid edge can be created.
- Invalid edge is blocked.
- Notes and groups are saved and reloaded.
- Canvas can load a saved workflow with branches.
