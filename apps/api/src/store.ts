/** Repository layer. All persistence goes through here; routes never write SQL. */
import type { DatabaseSync } from "node:sqlite";
import {
  newId,
  nowIso,
  canTransitionVersion,
  isVersionEditable,
  type Workflow,
  type WorkflowVersion,
  type WorkflowGraph,
  type ParameterDefinition,
  type Dataset,
  type DatasetVersion,
  type Execution,
  type NodeExecution,
  type VerificationReview,
  type PublishedTool,
  type VersionStatus,
  type ExecutionStatus
} from "@traceforge/domain";

export class StoreError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "StoreError";
  }
}

const J = {
  parse<T>(text: string | null | undefined, fallback: T): T {
    if (!text) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }
};

function workflowFromRow(r: any): Workflow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description,
    category: r.category,
    serviceTags: J.parse(r.service_tags, []),
    type: r.type,
    owner: r.owner,
    status: r.status,
    activeVersionId: r.active_version_id,
    templateSourceId: r.template_source_id,
    templateSourceVersion: r.template_source_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  };
}

function versionFromRow(r: any): WorkflowVersion {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    versionNumber: r.version_number,
    status: r.status,
    sourceVersionId: r.source_version_id,
    graph: J.parse(r.graph_json, { nodes: [], edges: [], annotations: [] }),
    parameters: J.parse(r.parameters_json, []),
    notes: r.notes,
    businessCase: r.business_case,
    requirementsAndDesignConsiderations: r.requirements,
    estimatedCostSavingsPerRun: r.est_cost_savings,
    estimatedTimeSavingsPerRun: r.est_time_savings,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedBy: r.published_by,
    publishedAt: r.published_at
  };
}

function datasetVersionFromRow(r: any): DatasetVersion {
  return {
    id: r.id,
    datasetId: r.dataset_id,
    storagePath: r.storage_path,
    contentHash: r.content_hash,
    sourceFileName: r.source_file_name,
    sourceFileHash: r.source_file_hash,
    sourceFileSize: r.source_file_size,
    rowCount: r.row_count,
    columns: J.parse(r.columns_json, []),
    createdAt: r.created_at,
    locked: !!r.locked
  };
}

function executionFromRow(r: any): Execution {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowVersionId: r.workflow_version_id,
    versionStatusAtRun: r.version_status_at_run,
    status: r.status,
    triggerType: r.trigger_type,
    rerunOfExecutionId: r.rerun_of_execution_id,
    parameterValues: J.parse(r.parameters_json, {}),
    inputDatasetVersionIds: J.parse(r.input_dsv_ids, []),
    outputDatasetVersionIds: J.parse(r.output_dsv_ids, []),
    errorSummary: r.error_summary,
    createdBy: r.created_by,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at
  };
}

function nodeExecutionFromRow(r: any): NodeExecution {
  return {
    id: r.id,
    executionId: r.execution_id,
    nodeId: r.node_id,
    nodeType: r.node_type,
    nodeLabel: r.node_label,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    inputSummary: J.parse(r.input_summary_json, {}),
    outputSummary: J.parse(r.output_summary_json, {}),
    outputDatasetVersionIds: J.parse(r.output_dsv_ids_json, {}),
    error: r.error,
    logs: J.parse(r.logs_json, [])
  };
}

function verificationFromRow(r: any): VerificationReview {
  return {
    id: r.id,
    workflowVersionId: r.workflow_version_id,
    tester: r.tester,
    reviewer: r.reviewer,
    testingPerformed: r.testing_performed,
    sampleExecutionId: r.sample_execution_id,
    decision: r.decision,
    decisionNotes: r.decision_notes,
    amendComments: r.amend_comments,
    createdAt: r.created_at,
    decidedAt: r.decided_at
  };
}

function publishedToolFromRow(r: any): PublishedTool {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    riskStatement: r.risk_statement,
    sourceWorkflowId: r.source_workflow_id,
    sourceWorkflowVersionId: r.source_workflow_version_id,
    status: r.status,
    publishedBy: r.published_by,
    publishedAt: r.published_at,
    unpublishedAt: r.unpublished_at
  };
}

export class Store {
  constructor(private db: DatabaseSync) {}

  audit(action: string, entityType: string, entityId: string, actor: string, detail: Record<string, unknown> = {}): void {
    this.db
      .prepare("INSERT INTO audit_log (id, action, entity_type, entity_id, actor, detail_json, at) VALUES (?,?,?,?,?,?,?)")
      .run(newId("log"), action, entityType, entityId, actor, JSON.stringify(detail), nowIso());
  }

  // --- Workflows -----------------------------------------------------------

  listWorkflows(opts: { includeArchived?: boolean; search?: string } = {}): (Workflow & { activeVersionNumber: number | null; verificationStatus: string; publishedBy: string | null; publishedAt: string | null; automationsConnected: number })[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflows ${opts.includeArchived ? "" : "WHERE status != 'archived'"} ORDER BY updated_at DESC`)
      .all() as any[];
    let workflows = rows.map(workflowFromRow);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      workflows = workflows.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          w.description.toLowerCase().includes(q) ||
          w.category.toLowerCase().includes(q) ||
          w.serviceTags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return workflows.map((w) => {
      const active = w.activeVersionId ? this.getVersion(w.activeVersionId) : null;
      const latestVerified = this.db
        .prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? AND status IN ('verified','active','superseded') ORDER BY version_number DESC LIMIT 1")
        .get(w.id) as any;
      const toolCount = this.db
        .prepare("SELECT COUNT(*) AS n FROM published_tools WHERE source_workflow_id = ? AND status = 'published'")
        .get(w.id) as any;
      const verificationStatus = active ? "verified" : latestVerified ? "verified" : this.hasVersionInStatus(w.id, "in_review") ? "in_review" : "unverified";
      return {
        ...w,
        activeVersionNumber: active?.versionNumber ?? null,
        verificationStatus,
        publishedBy: active?.publishedBy ?? null,
        publishedAt: active?.publishedAt ?? null,
        automationsConnected: Number(toolCount?.n ?? 0)
      };
    });
  }

  private hasVersionInStatus(workflowId: string, status: VersionStatus): boolean {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM workflow_versions WHERE workflow_id = ? AND status = ?")
      .get(workflowId, status) as any;
    return Number(r?.n ?? 0) > 0;
  }

  getWorkflow(id: string): Workflow {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as any;
    if (!row) throw new StoreError(`Workflow ${id} was not found.`, 404);
    return workflowFromRow(row);
  }

  createWorkflow(input: {
    name: string;
    description?: string;
    category?: string;
    serviceTags?: string[];
    type?: string;
    owner?: string;
    templateSourceId?: string | null;
    templateSourceVersion?: number | null;
    graph?: WorkflowGraph;
    parameters?: ParameterDefinition[];
    notes?: string;
    createdBy?: string;
  }): { workflow: Workflow; version: WorkflowVersion } {
    const name = (input.name ?? "").trim();
    if (!name) throw new StoreError("Workflow name cannot be blank.");
    if (name.length > 150) throw new StoreError("Workflow name is too long (max 150 characters).");
    const now = nowIso();
    const id = newId("wf");
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, description, category, service_tags, type, owner, status, template_source_id, template_source_version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'active', ?,?,?,?)`
      )
      .run(
        id,
        name,
        input.description ?? "",
        input.category ?? "",
        JSON.stringify(input.serviceTags ?? []),
        input.type ?? "Audit",
        input.owner ?? "",
        input.templateSourceId ?? null,
        input.templateSourceVersion ?? null,
        now,
        now
      );
    const version = this.insertVersion({
      workflowId: id,
      versionNumber: 1,
      status: "draft",
      graph: input.graph ?? { nodes: [], edges: [], annotations: [] },
      parameters: input.parameters ?? [],
      notes: input.notes ?? "",
      createdBy: input.createdBy ?? input.owner ?? ""
    });
    this.audit("create", "workflow", id, input.createdBy ?? "", { name });
    return { workflow: this.getWorkflow(id), version };
  }

  updateWorkflowMetadata(id: string, patch: Partial<Pick<Workflow, "name" | "description" | "category" | "serviceTags" | "type" | "owner">>): Workflow {
    const wf = this.getWorkflow(id);
    const name = patch.name !== undefined ? patch.name.trim() : wf.name;
    if (!name) throw new StoreError("Workflow name cannot be blank.");
    this.db
      .prepare("UPDATE workflows SET name=?, description=?, category=?, service_tags=?, type=?, owner=?, updated_at=? WHERE id=?")
      .run(
        name,
        patch.description ?? wf.description,
        patch.category ?? wf.category,
        JSON.stringify(patch.serviceTags ?? wf.serviceTags),
        patch.type ?? wf.type,
        patch.owner ?? wf.owner,
        nowIso(),
        id
      );
    return this.getWorkflow(id);
  }

  /** Archive-first deletion (ADR-009). Evidence is preserved. */
  archiveWorkflow(id: string, actor: string): Workflow {
    this.getWorkflow(id);
    this.db.prepare("UPDATE workflows SET status='archived', deleted_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), id);
    // Deactivate toolkit entries pointing at this workflow (ADR-012).
    this.db
      .prepare("UPDATE published_tools SET status='unpublished', unpublished_at=? WHERE source_workflow_id=? AND status='published'")
      .run(nowIso(), id);
    this.audit("archive", "workflow", id, actor);
    return this.getWorkflow(id);
  }

  restoreWorkflow(id: string, actor: string): Workflow {
    this.getWorkflow(id);
    this.db.prepare("UPDATE workflows SET status='active', deleted_at=NULL, updated_at=? WHERE id=?").run(nowIso(), id);
    this.audit("restore", "workflow", id, actor);
    return this.getWorkflow(id);
  }

  /** Hard delete allowed only for never-executed, never-verified, unpublished drafts (ADR-009). */
  hardDeleteWorkflow(id: string, actor: string): void {
    this.getWorkflow(id);
    const execCount = this.db.prepare("SELECT COUNT(*) AS n FROM executions WHERE workflow_id=?").get(id) as any;
    if (Number(execCount?.n) > 0) throw new StoreError("This workflow has execution evidence and cannot be permanently deleted. Archive it instead.", 409);
    const nonDraft = this.db
      .prepare("SELECT COUNT(*) AS n FROM workflow_versions WHERE workflow_id=? AND status NOT IN ('draft','archived')")
      .get(id) as any;
    if (Number(nonDraft?.n) > 0) throw new StoreError("This workflow has verified or reviewed versions and cannot be permanently deleted. Archive it instead.", 409);
    const tools = this.db.prepare("SELECT COUNT(*) AS n FROM published_tools WHERE source_workflow_id=?").get(id) as any;
    if (Number(tools?.n) > 0) throw new StoreError("This workflow has published toolkit entries and cannot be permanently deleted.", 409);
    this.db.prepare("DELETE FROM verification_reviews WHERE workflow_version_id IN (SELECT id FROM workflow_versions WHERE workflow_id=?)").run(id);
    this.db.prepare("DELETE FROM workflow_versions WHERE workflow_id=?").run(id);
    this.db.prepare("DELETE FROM workflows WHERE id=?").run(id);
    this.audit("hard_delete", "workflow", id, actor);
  }

  duplicateWorkflow(id: string, actor: string, newName?: string): { workflow: Workflow; version: WorkflowVersion } {
    const wf = this.getWorkflow(id);
    const source = wf.activeVersionId ? this.getVersion(wf.activeVersionId) : this.latestVersion(id);
    return this.createWorkflow({
      name: newName ?? `Copy of ${wf.name}`,
      description: wf.description,
      category: wf.category,
      serviceTags: wf.serviceTags,
      type: wf.type,
      owner: actor,
      graph: source?.graph,
      parameters: source?.parameters,
      notes: source?.notes ?? "",
      createdBy: actor
    });
  }

  // --- Versions ------------------------------------------------------------

  private insertVersion(input: {
    workflowId: string;
    versionNumber: number;
    status: VersionStatus;
    sourceVersionId?: string | null;
    graph: WorkflowGraph;
    parameters: ParameterDefinition[];
    notes?: string;
    businessCase?: string;
    requirements?: string;
    createdBy?: string;
  }): WorkflowVersion {
    const id = newId("wfv");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO workflow_versions (id, workflow_id, version_number, status, source_version_id, graph_json, parameters_json, notes, business_case, requirements, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.workflowId,
        input.versionNumber,
        input.status,
        input.sourceVersionId ?? null,
        JSON.stringify(input.graph),
        JSON.stringify(input.parameters),
        input.notes ?? "",
        input.businessCase ?? "",
        input.requirements ?? "",
        input.createdBy ?? "",
        now,
        now
      );
    return this.getVersion(id);
  }

  getVersion(id: string): WorkflowVersion {
    const row = this.db.prepare("SELECT * FROM workflow_versions WHERE id = ?").get(id) as any;
    if (!row) throw new StoreError(`Workflow version ${id} was not found.`, 404);
    return versionFromRow(row);
  }

  listVersions(workflowId: string): (WorkflowVersion & { isActive: boolean; verification: VerificationReview | null; activatedAt: string | null; activatedBy: string | null })[] {
    const wf = this.getWorkflow(workflowId);
    const rows = this.db
      .prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC")
      .all(workflowId) as any[];
    return rows.map((r) => ({
      ...versionFromRow(r),
      isActive: wf.activeVersionId === r.id,
      verification: this.latestVerification(r.id),
      activatedAt: r.activated_at,
      activatedBy: r.activated_by
    }));
  }

  latestVersion(workflowId: string): WorkflowVersion | null {
    const row = this.db
      .prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version_number DESC LIMIT 1")
      .get(workflowId) as any;
    return row ? versionFromRow(row) : null;
  }

  /** Update a DRAFT version in place. Immutable statuses are rejected (ADR-011). */
  updateDraftVersion(
    id: string,
    patch: Partial<{
      graph: WorkflowGraph;
      parameters: ParameterDefinition[];
      notes: string;
      businessCase: string;
      requirementsAndDesignConsiderations: string;
      estimatedCostSavingsPerRun: number | null;
      estimatedTimeSavingsPerRun: number | null;
    }>
  ): WorkflowVersion {
    const version = this.getVersion(id);
    if (!isVersionEditable(version.status)) {
      throw new StoreError(
        `Version ${version.versionNumber} is ${version.status} and cannot be edited. Create a new draft version instead.`,
        409
      );
    }
    this.db
      .prepare(
        `UPDATE workflow_versions SET graph_json=?, parameters_json=?, notes=?, business_case=?, requirements=?, est_cost_savings=?, est_time_savings=?, updated_at=? WHERE id=?`
      )
      .run(
        JSON.stringify(patch.graph ?? version.graph),
        JSON.stringify(patch.parameters ?? version.parameters),
        patch.notes ?? version.notes,
        patch.businessCase ?? version.businessCase,
        patch.requirementsAndDesignConsiderations ?? version.requirementsAndDesignConsiderations,
        patch.estimatedCostSavingsPerRun !== undefined ? patch.estimatedCostSavingsPerRun : version.estimatedCostSavingsPerRun,
        patch.estimatedTimeSavingsPerRun !== undefined ? patch.estimatedTimeSavingsPerRun : version.estimatedTimeSavingsPerRun,
        nowIso(),
        id
      );
    this.touchWorkflow(version.workflowId);
    return this.getVersion(id);
  }

  /** Create a new draft version from an existing version (editing verified/active creates a draft). */
  createDraftFrom(sourceVersionId: string, actor: string): WorkflowVersion {
    const source = this.getVersion(sourceVersionId);
    const latest = this.latestVersion(source.workflowId);
    const next = (latest?.versionNumber ?? 0) + 1;
    const draft = this.insertVersion({
      workflowId: source.workflowId,
      versionNumber: next,
      status: "draft",
      sourceVersionId: source.id,
      graph: source.graph,
      parameters: source.parameters,
      notes: source.notes,
      businessCase: source.businessCase,
      requirements: source.requirementsAndDesignConsiderations,
      createdBy: actor
    });
    this.audit("create_draft", "workflow_version", draft.id, actor, { from: source.id });
    this.touchWorkflow(source.workflowId);
    return draft;
  }

  transitionVersion(id: string, to: VersionStatus, actor: string): WorkflowVersion {
    const version = this.getVersion(id);
    if (!canTransitionVersion(version.status, to)) {
      throw new StoreError(`A ${version.status} version cannot become ${to}.`, 409);
    }
    this.db.prepare("UPDATE workflow_versions SET status=?, updated_at=? WHERE id=?").run(to, nowIso(), id);
    this.audit("transition", "workflow_version", id, actor, { from: version.status, to });
    this.touchWorkflow(version.workflowId);
    return this.getVersion(id);
  }

  /** Activation: only verified versions; previous active becomes superseded (features/versioning.md §3.3). */
  activateVersion(id: string, actor: string): WorkflowVersion {
    const version = this.getVersion(id);
    if (version.status !== "verified") {
      throw new StoreError(`Only verified versions can be activated. This version is ${version.status}.`, 409);
    }
    const wf = this.getWorkflow(version.workflowId);
    const now = nowIso();
    if (wf.activeVersionId && wf.activeVersionId !== id) {
      this.db.prepare("UPDATE workflow_versions SET status='superseded', updated_at=? WHERE id=? AND status='active'").run(now, wf.activeVersionId);
    }
    this.db
      .prepare("UPDATE workflow_versions SET status='active', activated_at=?, activated_by=?, published_by=?, published_at=?, updated_at=? WHERE id=?")
      .run(now, actor, actor, now, now, id);
    this.db.prepare("UPDATE workflows SET active_version_id=?, updated_at=? WHERE id=?").run(id, now, version.workflowId);
    this.audit("activate", "workflow_version", id, actor, { workflowId: version.workflowId });
    return this.getVersion(id);
  }

  private touchWorkflow(id: string): void {
    this.db.prepare("UPDATE workflows SET updated_at=? WHERE id=?").run(nowIso(), id);
  }

  // --- Verification ---------------------------------------------------------

  latestVerification(versionId: string): VerificationReview | null {
    const row = this.db
      .prepare("SELECT * FROM verification_reviews WHERE workflow_version_id=? ORDER BY created_at DESC LIMIT 1")
      .get(versionId) as any;
    return row ? verificationFromRow(row) : null;
  }

  upsertVerification(versionId: string, patch: Partial<Pick<VerificationReview, "tester" | "reviewer" | "testingPerformed" | "sampleExecutionId">>): VerificationReview {
    this.getVersion(versionId);
    let review = this.latestVerification(versionId);
    if (!review || review.decision) {
      const id = newId("ver");
      this.db
        .prepare("INSERT INTO verification_reviews (id, workflow_version_id, created_at) VALUES (?,?,?)")
        .run(id, versionId, nowIso());
      review = this.latestVerification(versionId)!;
    }
    this.db
      .prepare("UPDATE verification_reviews SET tester=?, reviewer=?, testing_performed=?, sample_execution_id=? WHERE id=?")
      .run(
        patch.tester ?? review.tester,
        patch.reviewer ?? review.reviewer,
        patch.testingPerformed ?? review.testingPerformed,
        patch.sampleExecutionId ?? review.sampleExecutionId,
        review.id
      );
    return this.latestVerification(versionId)!;
  }

  /**
   * Record a verification decision (features/verification-review.md §3.4–3.5).
   * pass → verified; fail → rejected; amend → back to draft.
   */
  decideVerification(
    versionId: string,
    decision: "pass" | "fail" | "amend",
    actor: string,
    notes: string,
    amendComments = ""
  ): { version: WorkflowVersion; review: VerificationReview } {
    const version = this.getVersion(versionId);
    if (version.status !== "in_review") {
      throw new StoreError(`Only versions in review can receive a verification decision. This version is ${version.status}.`, 409);
    }
    const review = this.latestVerification(versionId);
    if (!review) throw new StoreError("No verification record exists. Record tester/reviewer details first.", 409);
    if (!review.reviewer) throw new StoreError("A reviewer must be recorded before deciding verification.", 409);
    if (decision === "pass") {
      if (!review.tester) throw new StoreError("A tester must be recorded before passing verification.", 409);
      if (!review.sampleExecutionId) {
        throw new StoreError("A sample run is required before passing verification.", 409);
      }
      const exec = this.getExecution(review.sampleExecutionId);
      if (exec.status !== "succeeded") {
        throw new StoreError(`The linked sample run ${exec.status}. A successful sample run is required to pass.`, 409);
      }
    }
    const now = nowIso();
    this.db
      .prepare("UPDATE verification_reviews SET decision=?, decision_notes=?, amend_comments=?, decided_at=? WHERE id=?")
      .run(decision, notes, amendComments, now, review.id);
    const target: VersionStatus = decision === "pass" ? "verified" : decision === "fail" ? "rejected" : "draft";
    const updated = this.transitionVersion(versionId, target, actor);
    this.audit("verification_decision", "workflow_version", versionId, actor, { decision, notes });
    return { version: updated, review: this.latestVerification(versionId)! };
  }

  // --- Datasets --------------------------------------------------------------

  createDataset(
    name: string,
    kind: Dataset["kind"],
    provenance?: { sourceWorkflowId: string; sourceWorkflowName: string; sourceExecutionId: string; executedAt: string }
  ): Dataset {
    const id = newId("ds");
    this.db
      .prepare(
        "INSERT INTO datasets (id, name, kind, created_at, source_workflow_id, source_workflow_name, source_execution_id, executed_at) VALUES (?,?,?,?,?,?,?,?)"
      )
      .run(
        id,
        name,
        kind,
        nowIso(),
        provenance?.sourceWorkflowId ?? null,
        provenance?.sourceWorkflowName ?? null,
        provenance?.sourceExecutionId ?? null,
        provenance?.executedAt ?? null
      );
    return this.getDataset(id);
  }

  getDataset(id: string): Dataset {
    const row = this.db.prepare("SELECT * FROM datasets WHERE id=?").get(id) as any;
    if (!row) throw new StoreError(`Dataset ${id} was not found.`, 404);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      kind: row.kind,
      createdAt: row.created_at,
      sourceWorkflowId: row.source_workflow_id ?? null,
      sourceWorkflowName: row.source_workflow_name ?? null,
      sourceExecutionId: row.source_execution_id ?? null,
      executedAt: row.executed_at ?? null
    };
  }

  renameDataset(id: string, name: string): Dataset {
    this.getDataset(id);
    if (!name.trim()) throw new StoreError("Dataset name cannot be blank.");
    this.db.prepare("UPDATE datasets SET name=? WHERE id=?").run(name.trim(), id);
    return this.getDataset(id);
  }

  listDatasets(kinds?: Dataset["kind"][]): (Dataset & { latestVersion: DatasetVersion | null })[] {
    const rows = this.db.prepare("SELECT * FROM datasets ORDER BY created_at DESC").all() as any[];
    return rows
      .map(
        (row) =>
          ({
            id: row.id,
            workspaceId: row.workspace_id,
            name: row.name,
            kind: row.kind,
            createdAt: row.created_at,
            sourceWorkflowId: row.source_workflow_id ?? null,
            sourceWorkflowName: row.source_workflow_name ?? null,
            sourceExecutionId: row.source_execution_id ?? null,
            executedAt: row.executed_at ?? null
          }) as Dataset
      )
      .filter((d) => !kinds || kinds.includes(d.kind))
      .map((d) => ({ ...d, latestVersion: this.latestDatasetVersion(d.id) }));
  }

  createDatasetVersion(input: Omit<DatasetVersion, "id" | "createdAt" | "locked">): DatasetVersion {
    const id = newId("dsv");
    this.db
      .prepare(
        `INSERT INTO dataset_versions (id, dataset_id, storage_path, content_hash, source_file_name, source_file_hash, source_file_size, row_count, columns_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.datasetId,
        input.storagePath,
        input.contentHash,
        input.sourceFileName,
        input.sourceFileHash,
        input.sourceFileSize,
        input.rowCount,
        JSON.stringify(input.columns),
        nowIso()
      );
    return this.getDatasetVersion(id);
  }

  getDatasetVersion(id: string): DatasetVersion {
    const row = this.db.prepare("SELECT * FROM dataset_versions WHERE id=?").get(id) as any;
    if (!row) throw new StoreError(`Dataset version ${id} was not found.`, 404);
    return datasetVersionFromRow(row);
  }

  latestDatasetVersion(datasetId: string): DatasetVersion | null {
    const row = this.db
      .prepare("SELECT * FROM dataset_versions WHERE dataset_id=? ORDER BY created_at DESC LIMIT 1")
      .get(datasetId) as any;
    return row ? datasetVersionFromRow(row) : null;
  }

  lockDatasetVersions(ids: string[]): void {
    const stmt = this.db.prepare("UPDATE dataset_versions SET locked=1 WHERE id=?");
    for (const id of ids) stmt.run(id);
  }

  // --- Executions -------------------------------------------------------------

  createExecution(input: {
    workflowId: string;
    workflowVersionId: string;
    versionStatusAtRun: VersionStatus;
    triggerType?: Execution["triggerType"];
    rerunOfExecutionId?: string | null;
    parameterValues: Record<string, unknown>;
    createdBy: string;
  }): Execution {
    const id = newId("exec");
    this.db
      .prepare(
        `INSERT INTO executions (id, workflow_id, workflow_version_id, version_status_at_run, status, trigger_type, rerun_of_execution_id, parameters_json, created_by, created_at)
         VALUES (?,?,?,?, 'queued', ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.workflowId,
        input.workflowVersionId,
        input.versionStatusAtRun,
        input.triggerType ?? "manual",
        input.rerunOfExecutionId ?? null,
        JSON.stringify(input.parameterValues),
        input.createdBy,
        nowIso()
      );
    return this.getExecution(id);
  }

  getExecution(id: string): Execution {
    const row = this.db.prepare("SELECT * FROM executions WHERE id=?").get(id) as any;
    if (!row) throw new StoreError(`Execution ${id} was not found.`, 404);
    return executionFromRow(row);
  }

  listExecutions(workflowId?: string): Execution[] {
    const rows = workflowId
      ? (this.db.prepare("SELECT * FROM executions WHERE workflow_id=? ORDER BY created_at DESC").all(workflowId) as any[])
      : (this.db.prepare("SELECT * FROM executions ORDER BY created_at DESC LIMIT 200").all() as any[]);
    return rows.map(executionFromRow);
  }

  updateExecution(
    id: string,
    patch: Partial<{
      status: ExecutionStatus;
      startedAt: string;
      finishedAt: string;
      errorSummary: string | null;
      inputDatasetVersionIds: string[];
      outputDatasetVersionIds: string[];
    }>
  ): Execution {
    const cur = this.getExecution(id);
    this.db
      .prepare(
        "UPDATE executions SET status=?, started_at=?, finished_at=?, error_summary=?, input_dsv_ids=?, output_dsv_ids=? WHERE id=?"
      )
      .run(
        patch.status ?? cur.status,
        patch.startedAt ?? cur.startedAt,
        patch.finishedAt ?? cur.finishedAt,
        patch.errorSummary !== undefined ? patch.errorSummary : cur.errorSummary,
        JSON.stringify(patch.inputDatasetVersionIds ?? cur.inputDatasetVersionIds),
        JSON.stringify(patch.outputDatasetVersionIds ?? cur.outputDatasetVersionIds),
        id
      );
    return this.getExecution(id);
  }

  saveNodeExecution(record: NodeExecution): void {
    this.db
      .prepare(
        `INSERT INTO node_executions (id, execution_id, node_id, node_type, node_label, status, started_at, finished_at, input_summary_json, output_summary_json, output_dsv_ids_json, error, logs_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET status=excluded.status, started_at=excluded.started_at, finished_at=excluded.finished_at,
           input_summary_json=excluded.input_summary_json, output_summary_json=excluded.output_summary_json,
           output_dsv_ids_json=excluded.output_dsv_ids_json, error=excluded.error, logs_json=excluded.logs_json`
      )
      .run(
        record.id,
        record.executionId,
        record.nodeId,
        record.nodeType,
        record.nodeLabel,
        record.status,
        record.startedAt,
        record.finishedAt,
        JSON.stringify(record.inputSummary),
        JSON.stringify(record.outputSummary),
        JSON.stringify(record.outputDatasetVersionIds),
        record.error,
        JSON.stringify(record.logs)
      );
  }

  listNodeExecutions(executionId: string): NodeExecution[] {
    const rows = this.db
      .prepare("SELECT * FROM node_executions WHERE execution_id=? ORDER BY started_at, node_id")
      .all(executionId) as any[];
    return rows.map(nodeExecutionFromRow);
  }

  // --- Published tools ----------------------------------------------------------

  publishTool(input: {
    versionId: string;
    name?: string;
    category?: string;
    description?: string;
    riskStatement?: string;
    actor: string;
  }): PublishedTool {
    const version = this.getVersion(input.versionId);
    if (version.status !== "verified" && version.status !== "active") {
      throw new StoreError(
        `Only verified versions can be published to the toolkit. This version is ${version.status}. Complete verification first.`,
        409
      );
    }
    const wf = this.getWorkflow(version.workflowId);
    const id = newId("tool");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO published_tools (id, name, category, description, risk_statement, source_workflow_id, source_workflow_version_id, status, published_by, published_at)
         VALUES (?,?,?,?,?,?,?, 'published', ?, ?)`
      )
      .run(
        id,
        input.name ?? wf.name,
        input.category ?? wf.category,
        input.description ?? wf.description,
        input.riskStatement ?? "",
        wf.id,
        version.id,
        input.actor,
        now
      );
    this.audit("publish", "published_tool", id, input.actor, { versionId: version.id });
    return this.getPublishedTool(id);
  }

  getPublishedTool(id: string): PublishedTool {
    const row = this.db.prepare("SELECT * FROM published_tools WHERE id=?").get(id) as any;
    if (!row) throw new StoreError(`Published tool ${id} was not found.`, 404);
    return publishedToolFromRow(row);
  }

  listPublishedTools(includeUnpublished = false): PublishedTool[] {
    const rows = this.db
      .prepare(`SELECT * FROM published_tools ${includeUnpublished ? "" : "WHERE status='published'"} ORDER BY published_at DESC`)
      .all() as any[];
    return rows.map(publishedToolFromRow);
  }

  unpublishTool(id: string, actor: string): PublishedTool {
    this.getPublishedTool(id);
    this.db.prepare("UPDATE published_tools SET status='unpublished', unpublished_at=? WHERE id=?").run(nowIso(), id);
    this.audit("unpublish", "published_tool", id, actor);
    return this.getPublishedTool(id);
  }

  // --- LLM ------------------------------------------------------------------------

  saveLlmProvider(p: {
    id: string;
    type: string;
    displayName: string;
    baseUrl?: string;
    model?: string;
    deployment?: string;
    apiVersion?: string;
    apiKeyEncrypted?: string | null;
    timeoutMs?: number;
    isDefault?: boolean;
  }): void {
    if (p.isDefault) this.db.prepare("UPDATE llm_providers SET is_default=0").run();
    this.db
      .prepare(
        `INSERT INTO llm_providers (id, type, display_name, base_url, model, deployment, api_version, api_key_encrypted, timeout_ms, is_default, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (id) DO UPDATE SET type=excluded.type, display_name=excluded.display_name, base_url=excluded.base_url,
           model=excluded.model, deployment=excluded.deployment, api_version=excluded.api_version,
           api_key_encrypted=COALESCE(excluded.api_key_encrypted, llm_providers.api_key_encrypted),
           timeout_ms=excluded.timeout_ms, is_default=excluded.is_default`
      )
      .run(
        p.id,
        p.type,
        p.displayName,
        p.baseUrl ?? null,
        p.model ?? null,
        p.deployment ?? null,
        p.apiVersion ?? null,
        p.apiKeyEncrypted ?? null,
        p.timeoutMs ?? null,
        p.isDefault ? 1 : 0,
        nowIso()
      );
  }

  listLlmProviders(): any[] {
    return this.db.prepare("SELECT * FROM llm_providers ORDER BY created_at").all() as any[];
  }

  deleteLlmProvider(id: string): void {
    this.db.prepare("DELETE FROM llm_providers WHERE id=?").run(id);
  }

  saveLlmCall(call: {
    executionId?: string | null;
    providerId: string;
    providerType: string;
    kind: string;
    model: string;
    promptChars: number;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs: number;
    at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO llm_calls (id, execution_id, provider_id, provider_type, kind, model, prompt_chars, prompt_tokens, completion_tokens, latency_ms, at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        newId("llm"),
        call.executionId ?? null,
        call.providerId,
        call.providerType,
        call.kind,
        call.model,
        call.promptChars,
        call.promptTokens ?? null,
        call.completionTokens ?? null,
        call.latencyMs,
        call.at
      );
  }

  listLlmCalls(executionId: string): any[] {
    return this.db.prepare("SELECT * FROM llm_calls WHERE execution_id=? ORDER BY at").all(executionId) as any[];
  }

  // --- Settings ----------------------------------------------------------------------

  getSetting(key: string, fallback = ""): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as any;
    return row?.value ?? fallback;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  }
}
