# Feature Specification: Workflow Execution

## What this file is for

This file defines how workflows run locally: execution planning, node order, branch handling, node status, errors, cancellation, and output persistence.

## When to read this file

Read this file when building or changing:

- Run button behavior.
- Execution engine.
- DAG validation and topological ordering.
- Node execution status.
- Error handling and cancellation.
- Local queue/worker abstraction.
- Execution result persistence.

## When not to read this file

Do not read this file for catalog display, template browsing, or reviewer verification decisions except where execution results feed verification.


## Related files

- `../project.md` — global product and architecture rules.
- `../gates.md` — required checks before completion.
- `../decisions.md` — architectural decisions.
- `../glossary.md` — definitions.


## Agent instructions

1. Execute workflows locally by default.
2. Use immutable workflow version snapshots for execution.
3. Validate workflow structure before execution.
4. Persist enough state to support run history and evidence.
5. Never execute untrusted custom code without sandboxing.
6. Add tests for execution order, branch outputs, failure handling, and persisted results.

---

# 1. Feature summary

The execution engine runs a workflow version against selected inputs and parameters. For MVP, execution can be single-machine and local-first, but the design should keep a queue abstraction so it can later evolve to distributed workers.

# 2. Execution lifecycle

1. User clicks Run.
2. App validates workflow version, node configs, expressions, inputs, and parameters.
3. App creates an `ExecutionRecord` with status `queued` or `running`.
4. Engine builds execution plan from nodes and edges.
5. Nodes execute in dependency order.
6. Each node writes status, logs, row counts, and output dataset references.
7. Execution finishes as succeeded, failed, cancelled, or partially succeeded.
8. Run history and previews update.

# 3. MVP user stories

## 3.1 Run draft workflow

Acceptance criteria:

- User can run a draft workflow for testing.
- Run creates an execution record.
- Node statuses update during run.
- Output tables are available for preview.
- Failed node shows error details without crashing the app.

## 3.2 Run verified/active workflow

Acceptance criteria:

- User can run active version from detail page or canvas.
- Execution uses immutable active version snapshot.
- Parameters and input dataset versions are captured.
- Output evidence is preserved.

## 3.3 Cancel run

Acceptance criteria:

- User can cancel a running workflow.
- Running node receives cancellation where possible.
- Execution status becomes cancelled.
- Partial outputs are marked partial and not mistaken for verified outputs.

# 4. Execution rules

- MVP workflows are DAGs; cycles are not allowed.
- Fan-out is supported.
- Fan-in is supported only through nodes designed for it, such as Join or Append.
- Each node receives declared inputs only.
- Each node returns declared outputs only.
- Node execution must be deterministic given same workflow version, parameter values, and input dataset versions, unless node type is explicitly external/non-deterministic.

# 5. Local queue abstraction

MVP may use an in-process async queue or SQLite-backed queue. The code should hide this behind an interface:

```ts
interface ExecutionQueue {
  enqueue(command: StartExecutionCommand): Promise<ExecutionJobId>;
  cancel(executionId: string): Promise<void>;
  getStatus(executionId: string): Promise<ExecutionStatus>;
}
```

Do not leak the queue implementation into UI code.

# 6. Data model touchpoints

- `ExecutionRecord`
- `NodeExecutionRecord`
- `WorkflowVersionSnapshot`
- `WorkflowRunParameterValue`
- `DatasetVersion`
- `ExecutionLogEntry`

# 7. Error handling

- Validation errors block run before execution starts.
- Node errors mark the node failed and execution failed unless node has explicit continue-on-error config.
- External API errors include safe status details only.
- Python/custom-code errors include stderr/traceback only after redaction.
- Engine crash should leave execution in recoverable failed/stalled state.

# 8. Tests

Minimum tests:

- Simple linear workflow runs in order.
- Fan-out branches run after shared input.
- Join waits for required inputs.
- Invalid graph blocks run.
- Failed node marks execution failed.
- Cancelled run stores cancelled status.
- Execution stores parameter values and dataset references.
