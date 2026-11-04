-- Migration 002: Recording Schema
-- Ajusta CHECK de events.type para eventos de gravação (sem remover colunas ainda)

-- 1. Ajustar CHECK constraint de events.type para incluir novos tipos
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (
  type IN (
    'created', 'paired', 'pairing_refused', 'qr_reuse_blocked', 
    'state_changed', 'phone_lost', 'phone_back', 
    'transfer_start', 'transfer_end', 'closed'
  )
);

