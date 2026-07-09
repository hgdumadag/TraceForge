-- Adds workflow/run provenance to node-output datasets so repeated runs
-- of the same node type are distinguishable in the Datasets list.
ALTER TABLE datasets ADD COLUMN source_workflow_id TEXT;
ALTER TABLE datasets ADD COLUMN source_workflow_name TEXT;
ALTER TABLE datasets ADD COLUMN source_execution_id TEXT;
ALTER TABLE datasets ADD COLUMN executed_at TEXT;
