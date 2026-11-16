import { useRef, useState, useEffect, useCallback } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { X, Files, Maximize2, Check, Link2, Share2, Trash2 } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { StatusDot } from "../../components/ui/StatusDot.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { useCountdownSeconds, useLoginCode } from "../../hooks/useLoginCode.ts";
import { ManualLoginCode } from "../../components/ManualLoginCode.tsx";
import { useHeartbeat } from "../../hooks/useHeartbeat.ts";
import {
  createInvite,
  getSession,
  listInvites,
  requestLoginCode,
  revokeInvite,
  type InviteMode,
  type InviteSummary,
  type SessionInfo,
} from "../../lib/api.ts";
import { copyText } from "../../lib/clipboard.ts";
import { FileList } from "./FileList.tsx";
import { createPortal } from "react-dom";

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

interface ActiveSession {
  id: string;
  ownerToken: string;
  computerToken?: string;
  uploadToken?: string;
  qrToken?: string;
  visualId?: string;
  shortId?: string;
}

interface SessionCardProps {
  session: ActiveSession;
  publicBaseUrl: string;
  onClose: () => void;
  selected: boolean;
  onSelect: () => void;
  /** Session vanished server-side (restart/expiry) — parent must drop it. */
  onExpired?: () => void;
}

export function SessionCard({
  session,
  publicBaseUrl,
  onClose,
  selected,
  onSelect,
  onExpired,
}: SessionCardProps) {
  const [qrOpen, setQrOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMode, setInviteMode] = useState<InviteMode>("multi");
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [generatedInvite, setGeneratedInvite] = useState<{
    code: string;
    url: string;
  } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  const refreshInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      setInvites(await listInvites(session.id, session.ownerToken));
      setInviteError(null);
    } catch {
      setInviteError("Falha ao carregar convites");
    } finally {
      setInvitesLoading(false);
    }
  }, [session.id, session.ownerToken]);

  const { files, connected } = useSessionEvents(
    session.id,
    session.ownerToken,
    {
      role: "host",
      onSessionClosed: (reason) => {
        if (reason === "session_expired") onExpired?.();
      },
      onEvent: (event) => {
        if (event.type === "invite:used" && inviteOpen) {
          void refreshInvites();
        }
      },
    },
  );
  useHeartbeat(session.id, session.ownerToken);

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const { code: loginCode, deadline } = useLoginCode(session.id, session.ownerToken);
  const countdown = useCountdownSeconds(deadline);
  const [requestingCode, setRequestingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"id" | "code" | null>(null);
  const activeCode = loginCode && countdown > 0 ? loginCode : null;

  function copyValue(kind: "id" | "code", value: string) {
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
    });
  }

  async function generateCode() {
    setRequestingCode(true);
    setCodeError(null);
    try {
      await requestLoginCode(session.id, session.ownerToken);
    } catch {
      setCodeError("Falha ao gerar código");
    } finally {
      setRequestingCode(false);
    }
  }

  useEffect(() => {
    if (inviteOpen) void refreshInvites();
  }, [inviteOpen, refreshInvites]);

  async function generateInvite() {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const created = await createInvite(session.id, session.ownerToken, inviteMode);
      setGeneratedInvite(created);
      setInviteCopied(false);
      setInvites((prev) => [
        { code: created.code, mode: inviteMode, state: "valid" },
        ...prev.filter((invite) => invite.code !== created.code),
      ]);
    } catch {
      setInviteError("Falha ao gerar link");
    } finally {
      setInviteBusy(false);
    }
  }

  function copyInviteUrl() {
    if (!generatedInvite) return;
    void copyText(generatedInvite.url).then((ok) => {
      if (!ok) return;
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1500);
    });
  }

  async function shareInviteUrl() {
    if (!generatedInvite || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: "Link de convite",
        text: "Entre na sessão pelo link:",
        url: generatedInvite.url,
      });
    } catch {
      // User cancelled the share sheet.
    }
  }

  async function revokeInviteCode(code: string) {
    setRevokingCode(code);
    setInviteError(null);
    try {
      await revokeInvite(session.id, code, session.ownerToken);
      setInvites((prev) => prev.filter((invite) => invite.code !== code));
      setGeneratedInvite((prev) => (prev?.code === code ? null : prev));
    } catch {
      setInviteError("Falha ao revogar convite");
    } finally {
      setRevokingCode(null);
    }
  }

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const info = await getSession(session.id, session.ownerToken);
        if (active) setSessionInfo(info);
      } catch {
        // Ignora erros transitórios
      }
    }
    check();
    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [session.id, session.ownerToken]);

  const visualId = session.visualId || session.shortId;
  const qrToken = session.qrToken || session.uploadToken || "";
  const uploadUrl = qrToken
    ? `${publicBaseUrl}/entrar/${session.id}?qrToken=${encodeURIComponent(qrToken)}`
    : `${publicBaseUrl}/entrar/${session.id}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Fecha com Esc
  useEffect(() => {
    if (!qrOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [qrOpen]);

  // Bloqueia scroll do body
  useEffect(() => {
    document.body.style.overflow = qrOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [qrOpen]);

  function openQr(e: React.MouseEvent) {
    e.stopPropagation();
    // Gera dataURL a partir do canvas oculto
    const canvas = canvasRef.current;
    if (canvas) {
      setQrDataUrl(canvas.toDataURL("image/png"));
    }
    setQrOpen(true);
  }

  function closeQr() {
    setQrOpen(false);
  }

  return (
    <>
      {/* Canvas oculto de alta resolução — fonte do dataURL */}
      <div style={{ position: "absolute", left: "-9999px", top: "-9999px", visibility: "hidden" }}>
        <QRCodeCanvas
          ref={canvasRef}
          value={uploadUrl}
          size={600}
          marginSize={4}
          level="H"
        />
      </div>

      <Card
        className={[
          "overflow-hidden cursor-pointer transition-all",
          selected ? "ring-2 ring-[var(--color-accent)]" : "",
        ].join(" ")}
        onClick={onSelect}
      >
        <div className="p-4 flex items-start gap-4">
          {/* QR Code + visual ID */}
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={openQr}
              className="group relative flex-shrink-0 bg-white p-2 rounded-xl border border-[var(--color-border)] hover:ring-2 hover:ring-[var(--color-accent)] transition-all cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              aria-label="Ampliar QR Code"
              title="Clique para ampliar o QR Code"
            >
              <QRCodeSVG
                value={uploadUrl}
                size={100}
                marginSize={2}
                level="M"
              />
              <div className="absolute inset-0 bg-black/30 rounded-xl opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center justify-center transition-opacity text-white pointer-events-none">
                <Maximize2 size={22} strokeWidth={2} />
              </div>
            </button>
            {visualId && (
              <button
                type="button"
                data-testid="session-visual-id"
                onClick={(e) => {
                  e.stopPropagation();
                  copyValue("id", visualId);
                }}
                title="Clique para copiar o ID"
                className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[var(--color-accent-light)] text-[var(--color-accent)] tracking-wider cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)] transition-all"
              >
                ID: {visualId}
                {copied === "id" && (
                  <Check size={12} strokeWidth={2.5} className="ml-1 inline align-[-2px]" />
                )}
              </button>
            )}
            <ManualLoginCode
              code={activeCode}
              seconds={countdown}
              generating={requestingCode}
              error={codeError}
              onGenerate={generateCode}
              copied={copied === "code"}
              onCopy={() => copyValue("code", activeCode!)}
              className="mt-1 w-full"
            />
          </div>

          {/* Session info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusDot connected={connected} />
                {sessionInfo?.state === "DISCONNECTED" ? (
                  <Badge label="Reconectando..." variant="warn" />
                ) : sessionInfo?.phonePresent ? (
                  <Badge label="Visitante conectado" variant="success" />
                ) : null}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                aria-label="Encerrar sessão"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            <div className="mt-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
              <Files size={14} strokeWidth={1.5} />
              <span className="tabular">
                {files.length} arquivo{files.length !== 1 ? "s" : ""}
              </span>
            </div>

            <p className="mt-2 text-xs text-[var(--color-text-muted)] break-all leading-relaxed">
              Escaneie o QR Code no outro dispositivo
            </p>

            <button
              type="button"
              aria-expanded={inviteOpen}
              onClick={(event) => {
                event.stopPropagation();
                setInviteOpen((open) => !open);
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              <Link2 size={13} strokeWidth={1.75} />
              Gerar link de convite
            </button>
          </div>
        </div>

        {inviteOpen && (
          <div
            className="border-t border-[var(--color-border)] px-4 py-3 space-y-2"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold">Links de convite</h3>
              {invitesLoading && (
                <span className="text-[10px] text-[var(--color-text-muted)]">Atualizando…</span>
              )}
            </div>

            <div
              role="group"
              aria-label="Modo do convite"
              className="flex gap-0.5 rounded-[var(--radius-btn)] border border-[var(--color-border)] p-0.5"
            >
              {(["single", "multi"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={inviteMode === mode}
                  onClick={() => setInviteMode(mode)}
                  className={[
                    "flex-1 rounded-[var(--radius-btn)] px-2 py-1.5 text-[11px] font-medium transition-colors",
                    inviteMode === mode
                      ? "bg-[var(--color-accent)] text-white"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-accent-light)]",
                  ].join(" ")}
                >
                  {INVITE_MODE_LABEL[mode]}
                </button>
              ))}
            </div>

            <Button
              size="sm"
              className="w-full"
              onClick={() => void generateInvite()}
              disabled={inviteBusy}
            >
              <Link2 size={13} strokeWidth={1.75} />
              {inviteBusy ? "Gerando…" : "Gerar link"}
            </Button>

            {generatedInvite && (
              <div className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                <input
                  data-testid="invite-url"
                  aria-label="URL do convite"
                  readOnly
                  value={generatedInvite.url}
                  onFocus={(event) => event.currentTarget.select()}
                  className="w-full bg-transparent font-mono text-[11px] text-[var(--color-text)]"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={copyInviteUrl}
                  >
                    {inviteCopied ? (
                      <Check size={13} strokeWidth={2.5} />
                    ) : (
                      <Link2 size={13} strokeWidth={1.75} />
                    )}
                    {inviteCopied ? "Copiado" : "Copiar"}
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

            {inviteError && (
              <p className="text-[11px] text-[var(--color-error)]">{inviteError}</p>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Convites da sessão
              </p>
              {invites.length === 0 ? (
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {invitesLoading ? "Carregando…" : "Nenhum link ativo"}
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
                          onClick={() => void revokeInviteCode(invite.code)}
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

        {/* File list inline (for selected session) */}
        {selected && files.length > 0 && (
          <div className="border-t border-[var(--color-border)] max-h-64 overflow-hidden lg:hidden">
            <FileList files={files} sessionId={session.id} ownerToken={session.ownerToken} />
          </div>
        )}
      </Card>

      {/* Overlay com imagem do QR Code */}
      {qrOpen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR Code ampliado"
          style={{ position: "fixed", inset: 0, zIndex: 9999 }}
          className="flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          onClick={closeQr}
        >
          <div
            className="relative bg-white rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botão fechar */}
            <button
              type="button"
              onClick={closeQr}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label="Fechar"
            >
              <X size={16} strokeWidth={1.75} />
            </button>

            <h2 className="text-sm font-semibold text-gray-800">
              QR Code para envio de arquivos
            </h2>

            {visualId && (
              <button
                type="button"
                data-testid="session-modal-visual-id"
                onClick={(e) => {
                  e.stopPropagation();
                  copyValue("id", visualId);
                }}
                title="Clique para copiar o ID"
                className="font-mono font-bold text-base px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 tracking-widest border border-indigo-100 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all"
              >
                ID: {visualId}
                {copied === "id" && (
                  <Check size={13} strokeWidth={2.5} className="ml-1 inline align-[-2px]" />
                )}
              </button>
            )}

            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code para envio de arquivos"
                className="w-64 h-64 sm:w-72 sm:h-72 max-w-full"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <QRCodeSVG value={uploadUrl} size={280} marginSize={4} level="H" />
            )}

            <p className="text-xs text-gray-500 text-center">
              Aponte a câmera do outro dispositivo para o QR Code
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
