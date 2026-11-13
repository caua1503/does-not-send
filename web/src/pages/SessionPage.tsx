import { useState, useRef, useEffect } from "react";
import { Upload, Smartphone, AlertCircle, Plus } from "lucide-react";
import { Button } from "../components/ui/Button.tsx";
import { Card } from "../components/ui/Card.tsx";
import { ProgressBar } from "../components/ui/ProgressBar.tsx";
import { UploadItem, type GuestUploadItem } from "./guest/UploadItem.tsx";
import { getSession, type SessionInfo } from "../lib/api.ts";
import { useSessionEvents } from "../hooks/useSessionEvents.ts";
import { compressPhoto, isCompressiblePhoto } from "../lib/compressPhoto.ts";
import { convertHeicToJpeg, isHeic } from "../lib/convertHeic.ts";
import { BASE_URL } from "../lib/base.ts";
import { ImageEditor } from "../components/ImageEditor/ImageEditor.tsx";
import { TextWidget } from "../components/TextWidget.tsx";
import { buildTextFile, TEXT_MAX_LENGTH } from "../lib/textFile.ts";
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
  const [items, setItems] = useState<GuestUploadItem[]>([]);
  const [textError, setTextError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // (a) Cliente WS do visitante: auth primeiro, heartbeat a cada 10s, reconexão a cada 2s
  const {
    sessionClosed: wsSessionClosed,
    closedReason: wsClosedReason,
    reconnecting: wsReconnecting,
  } = useSessionEvents(sessionId, credential, {
    role: "guest",
    reconnectInterval: 2000,
  });

  const [remoteSession, setRemoteSession] = useState<SessionInfo | null>(null);

  // Estados derivados
  const isSessionClosed = wsSessionClosed || remoteSession?.state === "CLOSED";
  const isSessionClosedRef = useRef(isSessionClosed);
  isSessionClosedRef.current = isSessionClosed;
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

  // Consulta estado remoto (PAIRED, DISCONNECTED, CLOSED, computerPresent)
  useEffect(() => {
    if (!sessionId || !credential || isSessionClosed) return;

    let active = true;

    async function check() {
      try {
        const data = await getSession(sessionId, credential);
        if (!active) return;
        setRemoteSession(data);
      } catch (err: any) {
        if (!active) return;
        if (err?.status === 410) {
          setRemoteSession((prev) => (prev ? { ...prev, state: "CLOSED" } : { id: sessionId, state: "CLOSED", fileCount: 0, createdAt: "" }));
        }
      }
    }

    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [sessionId, credential, isSessionClosed]);

  const uploadSingleFile = (item: GuestUploadItem) => {
    if (isSessionClosed) return;

    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, state: "uploading", progress: 0, error: undefined } : i))
    );

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    // Fastify multipart accepts field name 'files' or single file parts
    formData.append("files", item.file, item.file.name);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = e.loaded / e.total;
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, progress } : i))
        );
      }
    };

    xhr.onload = () => {
      if (xhr.status === 201) {
        let remoteId: string | undefined;
        try {
          const body = JSON.parse(xhr.responseText) as { files?: Array<{ id?: string }> };
          remoteId = body.files?.[0]?.id;
        } catch {
          // resposta sem corpo válido: upload concluído, sem id remoto
        }
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, state: "completed", progress: 1, remoteId } : i
          )
        );
        if (item.kind === "text") setTextError(null);
      } else if (xhr.status === 401) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Falha de autorização no envio" } : i))
        );
      } else if (xhr.status === 410) {
        setRemoteSession((prev) => (prev ? { ...prev, state: "CLOSED" } : { id: sessionId, state: "CLOSED", fileCount: 0, createdAt: "" }));
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Sessão encerrada" } : i))
        );
      } else if (xhr.status === 404) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Sessão não encontrada" } : i))
        );
      } else if (xhr.status === 409) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Sessão não aceita envios" } : i))
        );
      } else if (xhr.status === 400 || xhr.status === 429) {
        let message =
          xhr.status === 429 ? "Muitos textos enviados, aguarde um pouco" : "Texto inválido";
        try {
          const body = JSON.parse(xhr.responseText) as { error?: unknown };
          if (typeof body.error === "string") message = body.error;
        } catch {
          // resposta sem corpo válido: mantém a mensagem padrão
        }
        if (item.kind === "text") setTextError(message);
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: message } : i))
        );
      } else if (xhr.status === 413) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Arquivo muito grande ou limite excedido" } : i))
        );
      } else if (xhr.status >= 500 && xhr.status < 600) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Servidor temporariamente indisponível" } : i))
        );
      } else {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: `Erro ${xhr.status}` } : i))
        );
      }
    };

    xhr.onerror = () => {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Sem conexão com o servidor" } : i))
      );
    };

    xhr.open(
      "POST",
      `${BASE_URL}/api/sessions/${sessionId}/files${item.kind === "text" ? "?kind=text" : ""}`,
    );
    xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
    xhr.send(formData);
  };

  const processAndUpload = async (id: string, initialFile: File) => {
    if (isSessionClosedRef.current) return;

    let finalFile = initialFile;
    try {
      finalFile = await compressPhoto(initialFile);
    } catch {
      finalFile = initialFile;
    }

    if (isSessionClosedRef.current) return;

    // HEIC com falha de conversão não vira upload cru: sem JPEG não há pré-visualização.
    try {
      finalFile = await convertHeicToJpeg(finalFile);
    } catch {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, state: "error", error: "Não foi possível converter a imagem HEIC" } : i
        )
      );
      return;
    }

    // Drop reference to initialFile from React state and set finalFile
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, file: finalFile, state: "uploading", progress: 0 } : i
      )
    );

    uploadSingleFile({
      id,
      file: finalFile,
      progress: 0,
      state: "uploading",
    });
  };

  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isSessionClosed) return;
    if (!e.target.files || e.target.files.length === 0) return;
    const fileList = Array.from(e.target.files);

    const newItems: GuestUploadItem[] = fileList.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      progress: 0,
      state: isHeic(file) || isCompressiblePhoto(file) ? "optimizing" : "pending",
    }));

    setItems((prev) => [...prev, ...newItems]);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Trigger upload or async compression pipeline
    newItems.forEach((item) => {
      if (item.state === "optimizing") {
        void processAndUpload(item.id, item.file);
      } else {
        uploadSingleFile(item);
      }
    });
  };

  const sendText = (raw: string): boolean => {
    if (isSessionClosedRef.current) return false;
    const text = raw.trim();
    if (!text) {
      setTextError("Texto não pode ser vazio");
      return false;
    }
    if (text.length > TEXT_MAX_LENGTH) {
      setTextError(`Texto excede o limite de ${TEXT_MAX_LENGTH} caracteres`);
      return false;
    }
    const file = buildTextFile(text, new Date(), items.map((i) => i.file.name));
    const item: GuestUploadItem = {
      id: `text-${Date.now()}-${Math.random()}`,
      file,
      progress: 0,
      state: "pending",
      kind: "text",
    };
    setTextError(null);
    setItems((prev) => [...prev, item]);
    uploadSingleFile(item);
    return true;
  };

  // PUT replaces the file content keeping the same remote id: no new item.
  const replaceEditedImage = (item: GuestUploadItem, file: File) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("files", file, file.name);
    // The old content is gone once the replace starts: never show it as fine.
    const fail = (error: string) => {
      if (xhr.status === 410) {
        setRemoteSession((prev) => (prev ? { ...prev, state: "CLOSED" } : { id: sessionId, state: "CLOSED", fileCount: 0, createdAt: "" }));
      }
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, state: "error", error } : i))
      );
    };

    xhr.onload = () => {
      if (xhr.status !== 200) {
        if (xhr.status === 401) fail("Falha de autorização na edição");
        else if (xhr.status === 410) fail("Sessão encerrada");
        else if (xhr.status === 404) fail("Arquivo não encontrado");
        else if (xhr.status === 409) fail("Sessão não aceita envios");
        else if (xhr.status === 413) fail("Arquivo muito grande ou limite excedido");
        else if (xhr.status >= 500) fail("Servidor temporariamente indisponível");
        else fail(`Erro ${xhr.status}`);
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                file,
                edited: true,
                error: undefined,
              }
            : i
        )
      );
    };
    xhr.onerror = () => fail("Sem conexão com o servidor");
    xhr.open("PUT", `${BASE_URL}/api/sessions/${sessionId}/files/${item.remoteId}`);
    xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
    xhr.send(formData);
  };

  const retryUpload = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    // A file that already reached the server is retried by replace, not POST.
    if (item.remoteId) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, state: "uploading", error: undefined } : i))
      );
      replaceEditedImage(item, item.file);
      return;
    }
    uploadSingleFile(item);
  };

  const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined;

  const totalFiles = items.length;
  const completedFiles = items.filter((i) => i.state === "completed").length;
  const isUploading = items.some(
    (i) => i.state === "uploading" || i.state === "pending" || i.state === "optimizing"
  );

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--color-bg)] max-w-md mx-auto md:max-w-2xl md:h-dvh md:overflow-hidden md:border-x md:border-[var(--color-border)]">
      {/* Header */}
      <header className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between sticky top-0 z-10 md:static md:px-6 md:py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone size={20} strokeWidth={1.5} className="text-[var(--color-accent)] shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm tracking-tight truncate">Enviar para Computador</span>
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
            <Button variant="ghost" size="sm" onClick={onLeave}>
              Sair da sessão
            </Button>
          )}
        </div>
      </header>

      {/* Status banners */}
      {isSessionClosed && (
        <div
          data-testid="status-session-closed"
          role="alert"
          className="bg-red-500/10 border-b border-red-500/20 px-4 py-3 text-center space-y-1"
        >
          <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-[var(--color-error)]">
            <AlertCircle size={16} />
            <span>Sessão encerrada</span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            {wsClosedReason === "user_closed"
              ? "Sessão encerrada pelo computador."
              : "Sessão encerrada."}
          </p>
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
          <span>Computador desconectado</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 p-4 flex flex-col gap-4 md:p-6 md:overflow-y-auto md:min-h-0">
        {/* Big Tap Area */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={isSessionClosed}
          className="hidden"
          id="guest-file-input"
          onChange={handleFilesChosen}
        />

        <label
          htmlFor={isSessionClosed ? undefined : "guest-file-input"}
          className={[
            "border-2 border-dashed border-[var(--color-border)]",
            isSessionClosed
              ? "opacity-50 cursor-not-allowed bg-[var(--color-surface)]"
              : "hover:border-[var(--color-accent)] cursor-pointer bg-[var(--color-surface)] active:scale-[0.99]",
            "rounded-2xl p-8 flex flex-col items-center justify-center gap-3 transition-all min-h-[160px] md:min-h-[120px] md:p-6",
          ].join(" ")}
          onClick={(e) => {
            if (isSessionClosed) {
              e.preventDefault();
            }
          }}
        >
          <div className="w-12 h-12 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center text-[var(--color-accent)]">
            <Upload size={24} strokeWidth={1.75} />
          </div>
          <div className="text-center">
            <span className="font-semibold text-base text-[var(--color-text)]">
              {isSessionClosed ? "Sessão encerrada" : "Escolher arquivos"}
            </span>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {isSessionClosed ? "Envio bloqueado" : "Fotos, vídeos e documentos"}
            </p>
          </div>
        </label>

        <TextWidget onSend={sendText} disabled={isSessionClosed} error={textError} />

        {/* Global Progress */}
        {totalFiles > 0 && (
          <div className="bg-[var(--color-surface)] p-3 rounded-xl border border-[var(--color-border)] space-y-1.5">
            <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
              <span>Progresso geral</span>
              <span className="tabular">{Math.round((completedFiles / totalFiles) * 100)}%</span>
            </div>
            <ProgressBar value={completedFiles} max={totalFiles} />
          </div>
        )}

        {/* Upload List */}
        <div className="flex-1 space-y-2">
          {items.map((item) => (
            <UploadItem
              key={item.id}
              item={item}
              onRetry={retryUpload}
              onEdit={isSessionClosed ? undefined : setEditingId}
            />
          ))}
        </div>

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
    </div>
  );
}
