import { useRef, useState, useEffect } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { X, Files, Maximize2, Check } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { StatusDot } from "../../components/ui/StatusDot.tsx";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { useCountdownSeconds, useLoginCode } from "../../hooks/useLoginCode.ts";
import { formatCodeGroups } from "../../lib/loginCode.ts";
import { useHeartbeat } from "../../hooks/useHeartbeat.ts";
import { getSession, requestLoginCode, type SessionInfo } from "../../lib/api.ts";
import { copyText } from "../../lib/clipboard.ts";
import { FileList } from "./FileList.tsx";
import { createPortal } from "react-dom";

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

  const { files, connected } = useSessionEvents(
    session.id,
    session.ownerToken,
    { role: "computer", onSessionClosed: (reason) => {
      if (reason === "session_expired") onExpired?.();
    } },
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
    ? `${publicBaseUrl}/enviar/${session.id}?qrToken=${encodeURIComponent(qrToken)}`
    : `${publicBaseUrl}/enviar/${session.id}`;

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
                  <Badge label="Telefone conectado" variant="success" />
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
              Escaneie o QR Code com o telefone
            </p>
          </div>
        </div>

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
              Aponte a câmera do telefone para o QR Code
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** On-demand numeric code, for devices that cannot read the QR. */
function ManualLoginCode({
  code,
  seconds,
  generating,
  error,
  onGenerate,
  copied,
  onCopy,
}: {
  code: string | null;
  seconds: number;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      data-testid="manual-login-code"
      className="mt-1 w-full flex flex-col items-center gap-0.5 text-center"
    >
      {code ? (
        <>
          <span className="text-[10px] text-[var(--color-text-muted)]">Código</span>
          <button
            type="button"
            data-testid="manual-login-code-value"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            title="Clique para copiar o código"
            className="font-mono font-bold text-sm tracking-widest tabular text-[var(--color-accent)] cursor-pointer hover:underline"
          >
            {formatCodeGroups(code)}
            {copied && (
              <Check size={12} strokeWidth={2.5} className="ml-1 inline align-[-2px]" />
            )}
          </button>
          <span className="text-[10px] tabular text-[var(--color-text-muted)]">
            troca em {seconds}s
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:ring-2 hover:ring-[var(--color-accent)] transition-all disabled:opacity-50"
        >
          {generating ? "Gerando…" : "Gerar código"}
        </button>
      )}
      {error && (
        <span className="text-[10px] text-[var(--color-error)]">{error}</span>
      )}
    </div>
  );
}
