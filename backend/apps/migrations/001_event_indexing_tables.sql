-- MC-55: Event Indexing Tables
-- Creates tables for on-chain event storage and indexer state management

-- Table for storing indexed on-chain events
CREATE TABLE IF NOT EXISTS on_chain_events (
  id BIGSERIAL PRIMARY KEY,
  contract_name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  data JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying by contract
CREATE INDEX IF NOT EXISTS idx_on_chain_events_contract ON on_chain_events(contract_name);

-- Index for efficient querying by block range
CREATE INDEX IF NOT EXISTS idx_on_chain_events_block ON on_chain_events(block_number);

-- Index for efficient querying by transaction hash
CREATE INDEX IF NOT EXISTS idx_on_chain_events_tx ON on_chain_events(tx_hash);

-- Table for storing event indexer state (checkpoint)
CREATE TABLE IF NOT EXISTS event_indexer_state (
  id TEXT PRIMARY KEY,
  last_block BIGINT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial state if not exists
INSERT INTO event_indexer_state (id, last_block)
VALUES ('global', 0)
ON CONFLICT (id) DO NOTHING;
