import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertCircle,
  Check,
  LogOut,
  Monitor,
  Smartphone,
  Users,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { UploadArea } from "../../components/UploadArea.tsx";
import { ManualLoginCode } from "../../components/ManualLoginCode.tsx";
import { LeaveSessionModal } from "../../components/LeaveSessionModal.tsx";
import { FileList } from "../host/FileList.tsx";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { useSessionUpload } from "../../hooks/useSessionUpload.ts";
import { useCountdownSeconds, useLoginCode } from "../../hooks/useLoginCode.ts";
import { useClosedCountdown } from "../../hooks/useClosedCountdown.ts";
import {
  ApiError,
  deleteItem,
  getSession,
  leaveSession,
  listFiles,
  requestLoginCode,
  type FileEntry,
  type ParticipantInfo,
} from "../../lib/api.ts";
import { BASE_URL } from "../../lib/base.ts";
import { copyText } from "../../lib/clipboard.ts";
import { clearGuestSession } from "../../lib/guestSessionStorage.ts";
import {
  canCloseSession,
  canDeleteItem,
  fileEntryToTwowayItem,
  initialTwowayState,
  itemToFileEntry,
  twowayReducer,
  type TwowayEvent,
} from "../../lib/twowayReducer.ts";
import { clearTwowaySession } from "../../lib/twowaySessionStorage.ts";
import { sessionClosedMessage } from "../../lib/sessionClosedMessage.ts";

interface TwowayRoomPageProps {
  sessionId: string;
  token: string;
  role: "host" | "guest";
  visualId?: string | null;
  qrToken?: string | null;
  hostId?: string | null;
  self?: ParticipantInfo | null;
  onExit: () => void;
  onSessionClosed?: () => void;
}

const publicBaseUrl = BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");

export function TwowayRoomPage({
  sessionId,
  token,
  role,
  visualId: initialVisualId,
  qrToken,
  hostId: initialHostId,
  self,
  onExit,
  onSessionClosed,
}: TwowayRoomPageProps) {
  const [state, dispatch] = useReducer(twowayReducer, initialTwowayState);
  const [visualId, setVisualId] = useState<string | null>(initialVisualId ?? null);
  const [hostId, setHostId] = useState<string | null>(initialHostId ?? null);
  const [localClosed, setLocalClosed] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [closing, setClosing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"id" | "code" | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const onSessionClosedRef = useRef(onSessionClosed);
  onSessionClosedRef.current = onSessionClosed;

  const { code: loginCode, deadline } = useLoginCode(
    role === "host" ? sessionId : null,
    role === "host" ? token : null,
  );
  const countdown = useCountdownSeconds(deadline);
  const activeCode = loginCode && countdown > 0 ? loginCode : null;

  const handleServerEvent = (event: Record<string, unknown>) => {
    dispatch(event as unknown as TwowayEvent);
  };

  const {
    sessionClosed,
    closedReason,
    connected,
    reconnecting,
  } = useSessionEvents(sessionId, token, {
    role,
    reconnectInterval: 2000,
    onEvent: handleServerEvent,
  });

  const isClosed = localClosed || sessionClosed;
  const closedCountdown = useClosedCountdown(role === "guest" && isClosed, onExit);

  useEffect(() => {
    if (!isClosed) return;
    dispatch({ type: "session:closed" });
    if (role === "guest") {
      clearGuestSession(sessionId);
      clearTwowaySession(sessionId);
    }
    onSessionClosedRef.current?.();
  }, [isClosed, role, sessionId]);

  useEffect(() => {
    let active = true;
    getSession(sessionId, token)
      .then((info) => {
        if (!active) return;
        if (info.visualId) setVisualId(info.visualId);
        if (info.hostId) setHostId(info.hostId);
        if (info.participants) {
          dispatch({ type: "participants:list", participants: info.participants });
        }
        if (info.state === "CLOSED") setLocalClosed(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 410) setLocalClosed(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId, token]);

  useEffect(() => {
    let active = true;
    listFiles(sessionId, token)
      .then((files) => {
        if (!active) return;
        dispatch({ type: "items:loaded", items: files.map(fileEntryToTwowayItem) });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 410) setLocalClosed(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId, token]);

  const upload = useSessionUpload({
    sessionId,
    credential: token,
    disabled: isClosed,
    onClosed: () => setLocalClosed(true),
  });

  const viewer = {
    participantId: role === "host" ? hostId : self?.id ?? null,
    isHost: role === "host" || (Boolean(hostId) && self?.id === hostId),
  };

  const fileEntries = useMemo(
    () => state.items.map(itemToFileEntry),
    [state.items],
  );

  const activeUploads = upload.items.filter((item) => item.state !== "completed");
  const sessionLabel = visualId ?? sessionId;
  const joinUrl = qrToken
    ? `${publicBaseUrl}/entrar/${sessionId}?qrToken=${encodeURIComponent(qrToken)}&mode=twoway`
    : null;

  function copyValue(kind: "id" | "code", value: string) {
    void copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(kind);
      window.setTimeout(
        () => setCopied((current) => (current === kind ? null : current)),
        1500,
      );
    });
  }

  async function generateCode() {
    setRequestingCode(true);
    setCodeError(null);
    try {
      await requestLoginCode(sessionId, token);
    } catch {
      setCodeError("Falha ao gerar código");
    } finally {
      setRequestingCode(false);
    }
  }

  async function removeItem(file: FileEntry) {
    setActionError(null);
    try {
      await deleteItem(sessionId, file.id, token);
    } catch {
      setActionError("Não foi possível apagar o item");
    }
  }

  async function closeRoom() {
    setClosing(true);
    setActionError(null);
    try {
      await leaveSession(sessionId, token);
      setConfirmClose(false);
      setLocalClosed(true);
    } catch {
      setActionError("Não foi possível encerrar a sessão");
      setClosing(false);
    }
  }

  async function leaveRoom() {
    setLeaving(true);
    try {
      await leaveSession(sessionId, token);
    } catch {
      // Offline or already closed: still drop the local session.
    }
    setLeaving(false);
    setConfirmLeave(false);
    onExit();
  }

  if (isClosed) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)] flex items-center justify-center mx-auto">
            <Check size={24} strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
              Sessão encerrada
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {sessionClosedMessage(closedReason)}
            </p>
            {role === "guest" && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Voltando para o início em {closedCountdown.seconds}s…
              </p>
            )}
            {role === "guest" && (
              <span className="sr-only" aria-live="polite">
                {closedCountdown.announcement}
              </span>
            )}
          </div>
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => {
              closedCountdown.cancel();
              onExit();
            }}
          >
            Voltar ao início
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-start gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Users size={20} strokeWidth={1.5} className="text-[var(--color-accent)]" />
              <h1 className="text-base font-semibold tracking-tight">Sessão de troca</h1>
              {connected ? (
                <Badge label="Conectado" variant="success" />
              ) : reconnecting ? (
                <Badge label="Reconectando..." variant="warn" />
              ) : (
                <Badge label="Conectando..." variant="neutral" />
              )}
            </div>

            <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--color-text-muted)]">ID da sessão</span>
                <button
                  type="button"
                  onClick={() => copyValue("id", sessionLabel)}
                  title="Copiar ID"
                  aria-label="Copiar ID"
                  className="inline-flex items-center justify-center min-h-11 sm:min-h-0 px-3 sm:py-1 font-mono font-bold text-sm rounded bg-[var(--color-accent-light)] text-[var(--color-accent)] tracking-wider cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)] transition-all whitespace-nowrap"
                >
                  {copied === "id" ? "Copiado" : sessionLabel}
                </button>
              </div>

              {role === "host" && (
                <ManualLoginCode
                  code={activeCode}
                  seconds={countdown}
                  generating={requestingCode}
                  error={codeError}
                  onGenerate={() => void generateCode()}
                  copied={copied === "code"}
                  onCopy={() => {
                    if (activeCode) copyValue("code", activeCode);
                  }}
                />
              )}
            </div>

            <p className="text-xs text-[var(--color-text-muted)]">
              {role === "host"
                ? "Compartilhe o QR Code ou o código. Todos enviam, baixam e veem o mesmo histórico."
                : "Todos participantes enviam e baixam os mesmos itens."}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              {role === "guest" ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)}>
                  <LogOut size={14} strokeWidth={1.75} />
                  Sair
                </Button>
              ) : canCloseSession(viewer) ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmClose(true)}>
                  <X size={14} strokeWidth={1.75} />
                  Encerrar sessão
                </Button>
              ) : null}
            </div>
            {joinUrl && (
              <div className="hidden sm:block bg-white p-2 rounded-xl border border-[var(--color-border)]">
                <QRCodeSVG value={joinUrl} size={104} marginSize={2} level="M" />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4 min-w-0">
          {actionError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-[var(--color-error)]"
            >
              <AlertCircle size={16} strokeWidth={1.75} />
              {actionError}
            </div>
          )}

          <Card className="p-4 space-y-4">
            <UploadArea
              inputId="twoway-file-input"
              inputRef={upload.fileInputRef}
              disabled={isClosed}
              items={activeUploads}
              textError={upload.textError}
              totalFiles={upload.totalFiles}
              completedFiles={upload.completedFiles}
              onFilesChosen={upload.handleFilesChosen}
              onSendText={upload.sendText}
              onRetry={upload.retryUpload}
              chooseLabel="Enviar arquivos"
              chooseHint="Todos na sala recebem"
            />
          </Card>

          <Card className="overflow-hidden min-h-[260px] flex flex-col">
            <FileList
              files={fileEntries}
              sessionId={sessionId}
              ownerToken={token}
              canDelete={(file) =>
                canDeleteItem(fileEntryToTwowayItem(file), viewer)
              }
              onDelete={(file) => void removeItem(file)}
            />
          </Card>
        </section>

        <aside className="space-y-4 min-w-0">
          {joinUrl && (
            <Card className="p-4 flex flex-col items-center gap-3 sm:hidden">
              <div className="bg-white p-2 rounded-xl">
                <QRCodeSVG value={joinUrl} size={180} marginSize={3} level="M" />
              </div>
              <p className="text-xs text-[var(--color-text-muted)] text-center">
                Aponte a câmera para entrar na sala.
              </p>
            </Card>
          )}

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight">Participantes</h2>
              <span className="text-xs tabular text-[var(--color-text-muted)]">
                {state.participants.length}
              </span>
            </div>

            {state.participants.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Ninguém conectado ainda.
              </p>
            ) : (
              <ul className="space-y-2">
                {state.participants.map((participant) => {
                  const isHost = participant.id === hostId;
                  const isSelf = participant.id === viewer.participantId;
                  return (
                    <li
                      key={participant.id}
                      className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2"
                    >
                      {participant.device === "desktop" ? (
                        <Monitor
                          size={16}
                          strokeWidth={1.5}
                          className="text-[var(--color-text-muted)] shrink-0"
                        />
                      ) : (
                        <Smartphone
                          size={16}
                          strokeWidth={1.5}
                          className="text-[var(--color-text-muted)] shrink-0"
                        />
                      )}
                      <span className="text-sm font-medium truncate flex-1 min-w-0">
                        {participant.name}
                      </span>
                      {isHost && <Badge label="Anfitrião" variant="neutral" />}
                      {isSelf && <Badge label="Você" variant="success" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <h2 className="text-sm font-semibold tracking-tight">Como funciona</h2>
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              Todos podem baixar qualquer item, inclusive os próprios. Só o autor ou o
              anfitrião apaga. O anfitrião encerra a sala e apaga tudo para todos.
            </p>
          </Card>
        </aside>
      </main>

      <Modal
        open={confirmClose}
        onClose={() => {
          if (!closing) setConfirmClose(false);
        }}
        title="Encerrar sessão?"
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClose(false)}
              disabled={closing}
            >
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={() => void closeRoom()} disabled={closing}>
              {closing ? "Encerrando..." : "Encerrar e apagar"}
            </Button>
          </div>
        }
      >
        <div className="p-4 space-y-2 text-sm text-[var(--color-text-muted)]">
          <p className="text-[var(--color-text)] font-medium">
            Os arquivos e textos serão apagados do servidor para todos os participantes.
          </p>
          <p>Esta ação não pode ser desfeita.</p>
        </div>
      </Modal>

      <LeaveSessionModal
        open={confirmLeave}
        role="guest"
        busy={leaving}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => void leaveRoom()}
      />
    </div>
  );
}
