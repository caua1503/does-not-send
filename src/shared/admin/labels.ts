import type { Category, CloseReason, Granularity, TransferStatus } from "./types.js";

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
  user_closed: "Encerrada pelo usuário",
  closed: "Encerrada",
  server_restart: "Reinício do servidor",
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

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}
