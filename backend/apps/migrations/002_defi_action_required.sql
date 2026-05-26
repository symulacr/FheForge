-- MC-049: defi_action_required table
-- Referenced by DefiActionRequired entity, repository, service, and controller
-- but has no CREATE TABLE DDL. Any request to POST /defi-modules/actions/required
-- fails with database error without this table.

CREATE TABLE IF NOT EXISTS defi_action_required (
  id UUID PRIMARY KEY,
  action_id UUID NOT NULL REFERENCES defi_module_actions(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES defi_modules(id) ON DELETE CASCADE,
  action_required_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defi_action_required_action_id
  ON defi_action_required(action_id);

CREATE INDEX IF NOT EXISTS idx_defi_action_required_module_id
  ON defi_action_required(module_id);
