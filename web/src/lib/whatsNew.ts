import { Gauge, ImageIcon, KeyRound, PencilLine, QrCode, Type, type LucideIcon } from "lucide-react";
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
  // Bumping the version starts a new cycle automatically.
  updateId: APP_VERSION,
  items: [
    {
      id: "multi-access-qr",
      title: "QR Code multiacessos",
      description: "Reconecte e acesse a mesma sessão em vários aparelhos.",
      category: "Conexão e sessões",
      icon: QrCode,
    },
    {
      id: "join-by-id",
      title: "Conexão por ID",
      description: "Entre numa sessão com identificador + código numérico.",
      category: "Conexão e sessões",
      icon: KeyRound,
    },
    {
      id: "better-compression",
      title: "Compressão aprimorada",
      description: "Imagens mais leves e envio mais rápido.",
      category: "Imagens e edição",
      icon: Gauge,
    },
    {
      id: "heic-jpeg",
      title: "HEIC → JPEG",
      description: "Compatibilidade com fotos de Android e iPhone.",
      category: "Imagens e edição",
      icon: ImageIcon,
    },
    {
      id: "image-editor",
      title: "Editor de imagens",
      description: "Desenhe, gire e corte antes de enviar.",
      category: "Imagens e edição",
      icon: PencilLine,
    },
    {
      id: "text-upload",
      title: "Envio de texto",
      description: "Escreva e envie textos direto pelo app, sem precisar de arquivo.",
      category: "Texto",
      icon: Type,
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
