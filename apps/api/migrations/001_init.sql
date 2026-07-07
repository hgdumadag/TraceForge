-- TraceForge initial schema. Metadata only; dataset contents live as Parquet
-- files outside the database (ADR-006).

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  service_tags TEXT NOT NULL DEFAULT '[]',
  type TEXT NOT NULL DEFAULT 'Audit',
  owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  active_version_id TEXT,
  template_source_id TEXT,
  template_source_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source_version_id TEXT,
  graph_json TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  business_case TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  est_cost_savings REAL,
  est_time_savings REAL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  activated_at TEXT,
  activated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_versions_workflow ON workflow_versions(workflow_id);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  storage_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_file_name TEXT,
  source_file_hash TEXT,
  source_file_size INTEGER,
  row_count INTEGER NOT NULL,
  columns_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dsv_dataset ON dataset_versions(dataset_id);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT NOT NULL,
  version_status_at_run TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  rerun_of_execution_id TEXT,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  input_dsv_ids TEXT NOT NULL DEFAULT '[]',
  output_dsv_ids TEXT NOT NULL DEFAULT '[]',
  error_summary TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exec_workflow ON executions(workflow_id);

CREATE TABLE IF NOT EXISTS node_executions (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id),
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  input_summary_json TEXT NOT NULL DEFAULT '{}',
  output_summary_json TEXT NOT NULL DEFAULT '{}',
  output_dsv_ids_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  logs_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_nodeexec_execution ON node_executions(execution_id);

CREATE TABLE IF NOT EXISTS verification_reviews (
  id TEXT PRIMARY KEY,
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
  tester TEXT NOT NULL DEFAULT '',
  reviewer TEXT NOT NULL DEFAULT '',
  testing_performed TEXT NOT NULL DEFAULT '',
  sample_execution_id TEXT,
  decision TEXT,
  decision_notes TEXT NOT NULL DEFAULT '',
  amend_comments TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_verif_version ON verification_reviews(workflow_version_id);

CREATE TABLE IF NOT EXISTS published_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  risk_statement TEXT NOT NULL DEFAULT '',
  source_workflow_id TEXT NOT NULL,
  source_workflow_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  published_by TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  unpublished_at TEXT
);

CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  deployment TEXT,
  api_version TEXT,
  -- Encrypted credential blob (never plaintext).
  api_key_encrypted TEXT,
  timeout_ms INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  execution_id TEXT,
  provider_id TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_chars INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
