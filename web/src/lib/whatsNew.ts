import { ArrowLeftRight, LogOut, type LucideIcon } from "lucide-react";
import pkg from "../../package.json";

export const APP_VERSION = pkg.version;

export interface WhatsNewItem {
  id: string;
  title: string;
  description: string;
  category: string;
  icon?: LucideIcon;
}

export interface WhatsNewConfig {
  enabled: boolean;
  maxViews: number;
  updateId: string;
  items: WhatsNewItem[];
}

export const WHATS_NEW: WhatsNewConfig = {
  enabled: true,
  maxViews: 3,
  // Bumping the version (or this suffix) starts a new cycle automatically.
  updateId: `${APP_VERSION}-convites`,
  items: [
    {
      id: "swap-session",
      title: "Sessão de troca",
      description: "Uma sala onde todos enviam e recebem arquivos, com histórico compartilhado.",
      category: "Conexão e sessões",
      icon: ArrowLeftRight,
    },
    {
      id: "clear-exit",
      title: "Saída e encerramento mais claros",
      description: "Confirmação ao sair da sessão e contagem regressiva quando ela é encerrada.",
      category: "Interface",
      icon: LogOut,
    },
  ],
};

export interface WhatsNewState {
  updateId: string;
  viewCount: number;
  lastViewedAt: string;
}

export const WHATS_NEW_STORAGE_KEY = "dns_whats_new";

function readState(): WhatsNewState | null {
  const raw = localStorage.getItem(WHATS_NEW_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<WhatsNewState>;
  if (typeof parsed.updateId !== "string" || typeof parsed.viewCount !== "number") {
    return null;
  }
  return {
    updateId: parsed.updateId,
    viewCount: parsed.viewCount,
    lastViewedAt: typeof parsed.lastViewedAt === "string" ? parsed.lastViewedAt : "",
  };
}

/**
 * Registers one view and reports whether the modal should be shown.
 * Returns false when persistence is unavailable: better hide than lose count.
 */
export function consumeWhatsNewView(config: WhatsNewConfig = WHATS_NEW): boolean {
  if (!config.enabled || config.maxViews <= 0) return false;
  try {
    const state = readState();
    const sameCycle = state?.updateId === config.updateId;
    if (sameCycle && state.viewCount >= config.maxViews) return false;

    const next: WhatsNewState = {
      updateId: config.updateId,
      viewCount: sameCycle ? state.viewCount + 1 : 1,
      lastViewedAt: new Date().toISOString(),
    };
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
