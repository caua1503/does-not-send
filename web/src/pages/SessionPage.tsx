import { useState, useRef, useEffect } from "react";
import { Upload, AlertCircle, Plus } from "lucide-react";
import { Button } from "../components/ui/Button.tsx";
import { Card } from "../components/ui/Card.tsx";
import { UploadArea } from "../components/UploadArea.tsx";
import { LeaveSessionModal } from "../components/LeaveSessionModal.tsx";
import { leaveSession } from "../lib/api.ts";
import { sessionClosedMessage } from "../lib/sessionClosedMessage.ts";
import { useSessionEvents } from "../hooks/useSessionEvents.ts";
import { useSessionUpload } from "../hooks/useSessionUpload.ts";
import { useClosedCountdown } from "../hooks/useClosedCountdown.ts";
import { ImageEditor } from "../components/ImageEditor/ImageEditor.tsx";
import { FileList } from "./host/FileList.tsx";
import { APP_VERSION } from "../lib/whatsNew.ts";

export type SessionPageRole = "host" | "guest";

export interface SessionPageProps {
  role: SessionPageRole;
  sessionId: string;
  token: string;
  visualId?: string | null;
  /** Guest only. */
  onLeave?: () => void;
  /** Guest only. Called once when the session becomes closed. */
  onSessionClosed?: () => void;
}

export function SessionPage({
  role,
  sessionId,
  token,
  visualId,
  onLeave,
  onSessionClosed,
}: SessionPageProps) {
  if (role === "host") {
    return <HostSession sessionId={sessionId} token={token} />;
  }
  return (
    <GuestSession
      sessionId={sessionId}
      token={token}
      visualId={visualId}
      onLeave={onLeave}
      onSessionClosed={onSessionClosed}
    />
  );
}

function HostSession({ sessionId, token }: { sessionId: string; token: string }) {
  const { files } = useSessionEvents(sessionId, token);
  return (
    <Card className="flex-1 overflow-hidden flex flex-col">
      <FileList files={files} sessionId={sessionId} ownerToken={token} />
    </Card>
  );
}

interface GuestSessionProps {
  sessionId: string;
  token: string;
  visualId?: string | null;
  onLeave?: () => void;
  onSessionClosed?: () => void;
}

function GuestSession({ sessionId, token: credential, visualId, onLeave, onSessionClosed }: GuestSessionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // (a) Cliente WS do visitante: auth primeiro, heartbeat a cada 10s, reconexão a cada 2s
  const {
    sessionClosed: wsSessionClosed,
    closedReason: wsClosedReason,
    reconnecting: wsReconnecting,
    sessionInfo: remoteSession,
  } = useSessionEvents(sessionId, credential, {
    role: "guest",
    reconnectInterval: 2000,
  });

  const [closedOnUpload, setClosedOnUpload] = useState(false);

  // Estados derivados
  const isSessionClosed = closedOnUpload || wsSessionClosed || remoteSession?.state === "CLOSED";
  const closedCountdown = useClosedCountdown(isSessionClosed, () => onLeave?.());

  const closeFromServer = () => setClosedOnUpload(true);

  const {
    items,
    textError,
    fileInputRef,
    handleFilesChosen,
    sendText,
    replaceEditedImage,
    retryUpload,
    totalFiles,
    completedFiles,
    isUploading,
  } = useSessionUpload({
    sessionId,
    credential,
    disabled: isSessionClosed,
    onClosed: closeFromServer,
  });
  const isReconnecting =
    !isSessionClosed &&
    (wsReconnecting || remoteSession?.state === "DISCONNECTED");
  const isHostDisconnected =
    !isSessionClosed && !isReconnecting && remoteSession?.computerPresent === false;

  const onSessionClosedRef = useRef(onSessionClosed);
  onSessionClosedRef.current = onSessionClosed;

  useEffect(() => {
    if (!isSessionClosed || !sessionId) return;
    onSessionClosedRef.current?.();
  }, [isSessionClosed, sessionId]);

  const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined;

  // Guest leave is best-effort on the server: files stay in the room and the
  // user can come back with the code while the session is open.
  const confirmGuestLeave = async () => {
    setLeaving(true);
    try {
      await leaveSession(sessionId, credential);
    } catch {
      // Offline or already closed: still drop the local session.
    }
    setLeaving(false);
    setConfirmLeave(false);
    onLeave?.();
  };

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--color-bg)] max-w-md mx-auto md:max-w-2xl md:h-dvh md:overflow-hidden md:border-x md:border-[var(--color-border)]">
      {/* Header */}
      <header className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between sticky top-0 z-10 md:static md:px-6 md:py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Upload size={20} strokeWidth={1.5} className="text-[var(--color-accent)] shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm tracking-tight truncate">Transferir arquivos</span>
            <span className="text-[11px] text-[var(--color-text-muted)] tabular shrink-0">
              v{APP_VERSION}
            </span>
            {visualId && (
              <span
                data-testid="guest-visual-id"
                className="px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-[var(--color-accent-light)] text-[var(--color-accent)] shrink-0"
              >
                ID: {visualId}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-xs text-[var(--color-text-muted)] tabular">
            {completedFiles}/{totalFiles} enviados
          </span>
          {!isSessionClosed && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)}>
              Sair da sessão
            </Button>
          )}
        </div>
      </header>

      {/* Status banners */}
      {isSessionClosed && (
        <div
          data-testid="status-session-closed"
          className="bg-red-500/10 border-b border-red-500/20 px-4 py-3 text-center space-y-1"
        >
          <div role="alert" className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--color-error)]">
              <AlertCircle size={16} />
              <span>Sessão encerrada</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              {sessionClosedMessage(wsClosedReason)}
            </p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Voltando para o início em {closedCountdown.seconds}s…
          </p>
          <span className="sr-only" aria-live="polite">
            {closedCountdown.announcement}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              closedCountdown.cancel();
              onLeave?.();
            }}
          >
            Voltar ao início
          </Button>
        </div>
      )}

      {isReconnecting && (
        <div
          data-testid="status-reconnecting"
          role="status"
          className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center justify-center gap-2"
        >
          <div className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
          <span>Reconectando...</span>
        </div>
      )}

      {isHostDisconnected && (
        <div
          data-testid="status-host-disconnected"
          role="status"
          className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs font-medium text-[var(--color-error)] flex items-center justify-center gap-2"
        >
          <AlertCircle size={14} />
          <span>Host desconectado</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 p-4 flex flex-col gap-4 md:p-6 md:overflow-y-auto md:min-h-0">
        <UploadArea
          inputId="guest-file-input"
          inputRef={fileInputRef}
          disabled={isSessionClosed}
          items={items}
          textError={textError}
          totalFiles={totalFiles}
          completedFiles={completedFiles}
          onFilesChosen={handleFilesChosen}
          onSendText={sendText}
          onRetry={retryUpload}
          onEdit={setEditingId}
        />
      </main>

      {/* Bottom Actions */}
      {totalFiles > 0 && !isUploading && (
        <div className="pt-2 sticky bottom-4 px-4 pb-4 md:static md:px-6">
          <Button
            variant="primary"
            size="lg"
            className="w-full shadow-lg"
            disabled={isSessionClosed}
            onClick={() => {
              if (!isSessionClosed) {
                fileInputRef.current?.click();
              }
            }}
          >
            <Plus size={18} strokeWidth={2} />
            {isSessionClosed ? "Sessão encerrada" : "Enviar mais arquivos"}
          </Button>
        </div>
      )}

      {editingItem && (
        <ImageEditor
          file={editingItem.file}
          onCancel={() => setEditingId(null)}
          onSave={(file) => {
            setEditingId(null);
            replaceEditedImage(editingItem, file);
          }}
        />
      )}

      <LeaveSessionModal
        open={confirmLeave}
        role="guest"
        busy={leaving}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => void confirmGuestLeave()}
      />
    </div>
  );
}
