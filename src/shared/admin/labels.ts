import type { Category, CloseReason, EventType, Granularity, TransferStatus } from "./types.js";

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  completed: "Concluída",
  failed: "Falha",
  receiving: "Em andamento",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  images: "Imagens",
  videos: "Vídeos",
  audios: "Áudios",
  pdfs: "PDFs",
  documents: "Documentos",
  archives: "Compactados",
  other: "Outros",
};

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  idle_timeout: "Inatividade",
  computer_lost: "Computador desconectado",
  phone_lost: "Celular desconectado",
  user_closed: "Encerrada pelo usuário",
  closed: "Encerrada",
  server_restart: "Reinício do servidor",
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  pairing_refused: "Pareamento recusado",
  qr_reused: "QR reutilizado",
};

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
  year: "Ano",
};

export const POSITION_LABELS = {
  sessionActive: "Em andamento",
  sessionClosed: "Encerrada",
  noData: "Sem dados no período",
  dbUnavailable: "Banco indisponível",
  loadFailed: "Não foi possível carregar os dados",
  retry: "Tentar de novo",
} as const;

export function transferStatusLabel(status: TransferStatus): string {
  return TRANSFER_STATUS_LABELS[status];
}

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

export function closeReasonLabel(reason: CloseReason | null): string | null {
  return reason ? CLOSE_REASON_LABELS[reason] : null;
}
