-- Migration 002: Recording Schema
-- Placeholder: nenhuma mudança estrutural necessária ainda
-- O sistema de gravação usa tabelas existentes (sessions, transfers, events) sem alterações no schema

-- Este arquivo existe para manter a sequência de migrações (001, 002, ...).
-- Futuras mudanças (remoção de colunas state/files_count/bytes_total de sessions,
-- ajuste de CHECK constraints) serão aplicadas quando o domínio migrar para não depender delas.

SELECT 1; -- no-op SQL válido
