-- Migration 001: Initial Schema
-- Sessions, Transfers, Events com índices, constraints e enums como TEXT + CHECK

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  visual_id TEXT NOT NULL,
  short_id TEXT NOT NULL,
  computer_ip TEXT NOT NULL,
  phone_ip TEXT,
  ua_summary TEXT,
  
  -- Authentication (hashes stored, cleared on close)
  computer_token_hash TEXT NOT NULL,
  phone_credential_hash TEXT,
  qr_token_hash TEXT,
  qr_consumed_at TIMESTAMPTZ,
  
  -- State machine
  state TEXT NOT NULL CHECK (state IN ('WAITING', 'PAIRED', 'TRANSFERRING', 'DISCONNECTED', 'CLOSED')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paired_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  close_reason TEXT CHECK (
    close_reason IS NULL OR 
    close_reason IN ('computer_closed', 'computer_lost', 'phone_lost', 'expired', 'server_restart', 'idle_timeout')
  ),
  
  -- Heartbeat tracking (unix epoch ms)
  last_seen_computer BIGINT,
  last_seen_phone BIGINT,
  phone_lost_at BIGINT,
  computer_lost_at BIGINT,
  
  -- Counters
  active_uploads INTEGER NOT NULL DEFAULT 0,
  files_count INTEGER NOT NULL DEFAULT 0,
  bytes_total BIGINT NOT NULL DEFAULT 0
);

-- Transfers table
CREATE TABLE transfers (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT,
  extension TEXT NOT NULL,
  mime TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('images', 'videos', 'audios', 'pdfs', 'documents', 'archives', 'other')
  ),
  size BIGINT NOT NULL,
  phone_ip TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('uploading', 'done', 'aborted', 'discarded')
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- Events table
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'created', 'paired', 'pairing_refused', 'qr_reuse_blocked', 
      'state_changed', 'phone_lost', 'phone_back', 
      'transfer_start', 'transfer_end', 'closed'
    )
  ),
  result TEXT CHECK (
    result IS NULL OR 
    result IN ('ok', 'already_consumed', 'invalid', 'not_found')
  ),
  from_state TEXT,
  to_state TEXT,
  ip TEXT,
  ua_summary TEXT,
  detail JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: Sessions
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
CREATE INDEX idx_sessions_computer_ip ON sessions(computer_ip);
CREATE INDEX idx_sessions_phone_ip ON sessions(phone_ip) WHERE phone_ip IS NOT NULL;
CREATE INDEX idx_sessions_visual_id ON sessions(visual_id);
CREATE INDEX idx_sessions_short_id ON sessions(short_id);
CREATE INDEX idx_sessions_state ON sessions(state) WHERE state != 'CLOSED';

-- Indexes: Transfers
CREATE INDEX idx_transfers_started_at ON transfers(started_at);
CREATE INDEX idx_transfers_session_id ON transfers(session_id);
CREATE INDEX idx_transfers_category_started ON transfers(category, started_at);
CREATE INDEX idx_transfers_status_started ON transfers(status, started_at);
CREATE INDEX idx_transfers_phone_ip_started ON transfers(phone_ip, started_at);

-- Indexes: Events
CREATE INDEX idx_events_session_at ON events(session_id, at);
CREATE INDEX idx_events_ip_at ON events(ip, at);
CREATE INDEX idx_events_type_at ON events(type, at);
