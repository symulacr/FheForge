-- MC-095: auth_nonces table for wallet authentication nonce storage
-- Replaces in-memory Map to support horizontal scaling and prevent nonce loss on restart.
-- Nonces expire after 5 minutes (enforced by application logic and DB timestamp).

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet_address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes')
);
