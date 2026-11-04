/**
 * SqlStore — Implementação de RecorderStore com Postgres
 * 
 * Mapeia eventos de domínio para operações SQL:
 * - session_created → INSERT sessions (ON CONFLICT DO NOTHING)
 * - session_paired → UPDATE paired_at, phone_ip, ua_summary
 * - session_closed → UPDATE closed_at, close_reason (só se closed_at IS NULL)
 * - transfer_started → INSERT transfers (id gerado com Bun.randomUUIDv7())
 * - transfer_finished → UPDATE status, finished_at WHERE status='uploading'
 * - pairing_refused, qr_reuse_blocked, phone_lost, phone_back → INSERT events
 * 
 * Usa transação (sql.begin) para processar cada lote atomicamente.
 * bigint do banco convertido para number na leitura (seguro até 9 PB).
 */

import { sql } from "../db/db.js";
import type { RecorderStore } from "./recorder.js";
import type { DomainEvent } from "./events.js";
import { normalizeIp, parseUserAgent, categorize, sanitizeFileName } from "./functions.js";

export class SqlStore implements RecorderStore {
  async apply(batch: DomainEvent[]): Promise<void> {
    await sql.begin(async (tx) => {
      for (const event of batch) {
        await this.applyOne(tx, event);
      }
    });
  }

  private async applyOne(tx: typeof sql, event: DomainEvent): Promise<void> {
    switch (event.type) {
      case "session_created": {
        const normalizedIp = normalizeIp(event.computerIp);
        await tx`
          INSERT INTO sessions (
            id, visual_id, short_id, computer_ip, computer_token_hash, state, created_at
          )
          VALUES (
            ${event.sessionId},
            ${event.visualId},
            ${event.visualId},
            ${normalizedIp},
            '',
            'CLOSED',
            to_timestamp(${event.timestamp / 1000})
          )
          ON CONFLICT (id) DO NOTHING
        `;
        break;
      }

      case "session_paired": {
        const normalizedIp = normalizeIp(event.phoneIp);
        const uaSummary = parseUserAgent(event.userAgent);
        await tx`
          UPDATE sessions
          SET 
            paired_at = to_timestamp(${event.timestamp / 1000}),
            phone_ip = ${normalizedIp},
            ua_summary = ${uaSummary}
          WHERE id = ${event.sessionId}
        `;
        break;
      }

      case "session_closed": {
        await tx`
          UPDATE sessions
          SET 
            closed_at = to_timestamp(${event.timestamp / 1000}),
            close_reason = ${event.closeReason}
          WHERE id = ${event.sessionId}
            AND closed_at IS NULL
        `;
        break;
      }

      case "transfer_started": {
        const transferId = event.transferId || Bun.randomUUIDv7();
        const normalizedIp = normalizeIp(event.phoneIp);
        const sanitizedName = sanitizeFileName(event.fileName);
        const category = categorize(event.extension, event.mime);

        await tx`
          INSERT INTO transfers (
            id, session_id, name, extension, mime, category, size, phone_ip, status, started_at
          )
          VALUES (
            ${transferId},
            ${event.sessionId},
            ${sanitizedName},
            ${event.extension},
            ${event.mime},
            ${category},
            ${event.size},
            ${normalizedIp},
            'uploading',
            to_timestamp(${event.timestamp / 1000})
          )
        `;
        break;
      }

      case "transfer_finished": {
        await tx`
          UPDATE transfers
          SET 
            status = ${event.status},
            finished_at = to_timestamp(${event.timestamp / 1000})
          WHERE id = ${event.transferId}
            AND status = 'uploading'
        `;
        break;
      }

      case "pairing_refused":
      case "qr_reuse_blocked":
      case "phone_lost":
      case "phone_back": {
        const detail: Record<string, any> = {};
        
        if (event.type === "pairing_refused") {
          detail.reason = event.reason;
          detail.ip = normalizeIp(event.phoneIp);
          detail.ua_summary = parseUserAgent(event.userAgent);
        } else if (event.type === "qr_reuse_blocked") {
          detail.ip = normalizeIp(event.phoneIp);
          detail.ua_summary = parseUserAgent(event.userAgent);
        }

        await tx`
          INSERT INTO events (session_id, type, detail, at)
          VALUES (
            ${event.sessionId},
            ${event.type},
            ${JSON.stringify(detail)},
            to_timestamp(${event.timestamp / 1000})
          )
        `;
        break;
      }

      default: {
        // Evento desconhecido: ignorar silenciosamente
        const _exhaustive: never = event;
        break;
      }
    }
  }
}
