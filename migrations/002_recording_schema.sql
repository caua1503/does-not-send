-- Migration 002: Recording Schema
-- Remove colunas de estado transitório e contadores, ajusta CHECK de events.type

-- 1. Remover colunas de estado transitório e contadores de sessions
ALTER TABLE sessions DROP COLUMN IF EXISTS state;
ALTER TABLE sessions DROP COLUMN IF EXISTS files_count;
ALTER TABLE sessions DROP COLUMN IF EXISTS bytes_total;

-- 2. Remover colunas de transição de events
ALTER TABLE events DROP COLUMN IF EXISTS from_state;
ALTER TABLE events DROP COLUMN IF EXISTS to_state;

-- 3. Ajustar CHECK constraint de events.type
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (
  type IN (
    'pairing_refused',
    'qr_reuse_blocked',
    'phone_lost',
    'phone_back'
  )
);
