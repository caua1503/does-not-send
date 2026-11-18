import { useCallback, useEffect, useState } from "react";
import { Check, Link2, Share2, Trash2 } from "lucide-react";
import { Badge } from "./ui/Badge.tsx";
import { Button } from "./ui/Button.tsx";
import { copyText } from "../lib/clipboard.ts";
import {
  createInvite,
  listInvites,
  revokeInvite,
  type InviteMode,
  type InviteSummary,
} from "../lib/api.ts";

const INVITE_MODE_LABEL: Record<InviteMode, string> = {
  single: "Acesso único",
  multi: "Vários acessos",
};

const INVITE_MODE_SHORT: Record<InviteMode, string> = {
  single: "Único",
  multi: "Vários",
};

const INVITE_STATE: Record<
  InviteSummary["state"],
  { label: string; variant: "neutral" | "success" | "warn" | "error" }
> = {
  valid: { label: "Ativo", variant: "success" },
  used: { label: "Usado", variant: "warn" },
  expired: { label: "Expirado", variant: "neutral" },
  revoked: { label: "Revogado", variant: "neutral" },
};

interface InviteLinksPanelProps {
  sessionId: string;
  token: string;
  /** Incrementado pelo host quando um convite é resgatado. */
  refreshSignal?: number;
  className?: string;
}

export function InviteLinksPanel({
  sessionId,
  token,
  refreshSignal = 0,
  className = "",
}: InviteLinksPanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<InviteMode>("multi");
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshInvites = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await listInvites(sessionId, token));
      setError(null);
    } catch {
      setError("Falha ao carregar convites");
    } finally {
      setLoading(false);
    }
  }, [sessionId, token]);

  useEffect(() => {
    if (open) void refreshInvites();
  }, [open, refreshInvites, refreshSignal]);

  async function generateInvite() {
    setBusy(true);
    setError(null);
    try {
      const created = await createInvite(sessionId, token, mode);
      setGenerated(created);
      setCopied(false);
      setInvites((prev) => [
        { code: created.code, mode, state: "valid" },
        ...prev.filter((invite) => invite.code !== created.code),
      ]);
    } catch {
      setError("Falha ao gerar link");
    } finally {
      setBusy(false);
    }
  }

  function copyInviteUrl() {
    if (!generated) return;
    void copyText(generated.url).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  async function shareInviteUrl() {
    if (!generated || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: "Link de convite",
        text: "Entre na sessão pelo link:",
        url: generated.url,
      });
    } catch {
      // User cancelled the share sheet.
    }
  }

  async function revoke(code: string) {
    setRevokingCode(code);
    setError(null);
    try {
      await revokeInvite(sessionId, code, token);
      setInvites((prev) => prev.filter((invite) => invite.code !== code));
      setGenerated((prev) => (prev?.code === code ? null : prev));
    } catch {
      setError("Falha ao revogar convite");
    } finally {
      setRevokingCode(null);
    }
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
      >
        <Link2 size={13} strokeWidth={1.75} />
        Gerar link de convite
      </button>

      {open && (
        <div
          className="mt-2 rounded-xl border border-[var(--color-border)] p-3 space-y-2"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">Links de convite</h3>
            {loading && (
              <span className="text-[10px] text-[var(--color-text-muted)]">Atualizando…</span>
            )}
          </div>

          <div
            role="group"
            aria-label="Modo do convite"
            className="flex gap-0.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] p-0.5"
          >
            {(["single", "multi"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={[
                  "flex-1 rounded-[var(--radius-btn)] px-2 py-1.5 text-[11px] font-medium transition-colors",
                  mode === option
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-accent-light)]",
                ].join(" ")}
              >
                {INVITE_MODE_LABEL[option]}
              </button>
            ))}
          </div>

          <Button size="sm" className="w-full" onClick={() => void generateInvite()} disabled={busy}>
            <Link2 size={13} strokeWidth={1.75} />
            {busy ? "Gerando…" : "Gerar link"}
          </Button>

          {generated && (
            <div className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
              <input
                data-testid="invite-url"
                aria-label="URL do convite"
                readOnly
                value={generated.url}
                onFocus={(event) => event.currentTarget.select()}
                className="w-full bg-transparent font-mono text-[11px] text-[var(--color-text)]"
              />
              <div className="mt-1.5 flex gap-1.5">
                <Button variant="ghost" size="sm" className="flex-1" onClick={copyInviteUrl}>
                  {copied ? (
                    <Check size={13} strokeWidth={2.5} />
                  ) : (
                    <Link2 size={13} strokeWidth={1.75} />
                  )}
                  {copied ? "Copiado" : "Copiar"}
                </Button>
                {canShare && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => void shareInviteUrl()}
                  >
                    <Share2 size={13} strokeWidth={1.75} />
                    Compartilhar
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-[11px] text-[var(--color-error)]">{error}</p>}

          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Convites da sessão
            </p>
            {invites.length === 0 ? (
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                {loading ? "Carregando…" : "Nenhum link ativo"}
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-[var(--color-border)]">
                {invites.map((invite) => {
                  const state = INVITE_STATE[invite.state];
                  return (
                    <li
                      key={invite.code}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[11px]">/i/{invite.code}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <Badge label={INVITE_MODE_SHORT[invite.mode]} variant="neutral" />
                          <Badge label={state.label} variant={state.variant} />
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Revogar convite ${invite.code}`}
                        title="Revogar convite"
                        onClick={() => void revoke(invite.code)}
                        disabled={revokingCode === invite.code}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-red-50 hover:text-[var(--color-error)] disabled:opacity-40 dark:hover:bg-red-950/30"
                      >
                        <Trash2 size={13} strokeWidth={1.75} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
