import { useState, useRef, useEffect } from "react";
import { Upload, Smartphone, AlertCircle, Plus } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ProgressBar } from "../../components/ui/ProgressBar.tsx";
import { UploadItem, type PhoneUploadItem } from "./UploadItem.tsx";
import { pairSession, getSession, type SessionInfo } from "../../lib/api.ts";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { compressPhoto, isCompressiblePhoto } from "../../lib/compressPhoto.ts";
import { convertHeicToJpeg, isHeic } from "../../lib/convertHeic.ts";
import { BASE_URL } from "../../lib/base.ts";
import { ImageEditor } from "../../components/ImageEditor/ImageEditor.tsx";

const SCAN_AGAIN_MESSAGE = "Escaneie o QR Code novamente.";

interface PhonePageProps {
  sessionId?: string;
  token?: string;
  qrToken?: string;
}

interface StoredSession {
  phoneCredential?: string;
  visualId?: string;
}

function readStoredSession(id: string): { phoneCredential: string | null; visualId: string | null } {
  if (!id) return { phoneCredential: null, visualId: null };
  try {
    const raw = localStorage.getItem(`dns_phone_cred_${id}`);
    if (!raw) return { phoneCredential: null, visualId: null };
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && typeof parsed === "object") {
        return {
          phoneCredential: parsed.phoneCredential || null,
          visualId: parsed.visualId || null,
        };
      }
      return { phoneCredential: raw, visualId: null };
    } catch {
      return { phoneCredential: raw, visualId: null };
    }
  } catch {
    return { phoneCredential: null, visualId: null };
  }
}

function clearStoredSession(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(`dns_phone_cred_${id}`);
  } catch {}
}

export default function PhonePage({
  sessionId: propSessionId,
  token: propToken,
  qrToken: propQrToken,
}: PhonePageProps) {
  // Extract from props or URL
  const pathParts = window.location.pathname.split("/");
  const urlSessionId = propSessionId || pathParts[2] || "";
  const searchParams = new URLSearchParams(window.location.search);
  const qrToken = propQrToken || searchParams.get("qrToken") || "";
  const legacyToken = propToken || searchParams.get("token") || "";

  const storageKey = urlSessionId ? `dns_phone_cred_${urlSessionId}` : "";
  const initialStored = readStoredSession(urlSessionId);

  const [credential, setCredential] = useState<string | null>(
    initialStored.phoneCredential || (!qrToken && legacyToken ? legacyToken : null)
  );
  const [visualId, setVisualId] = useState<string | null>(initialStored.visualId);
  const [isPairing, setIsPairing] = useState<boolean>(() => {
    return Boolean(urlSessionId && !initialStored.phoneCredential && qrToken);
  });
  const [sessionError, setSessionError] = useState<string | null>(() => {
    if (!urlSessionId) return SCAN_AGAIN_MESSAGE;
    if (!initialStored.phoneCredential && !qrToken && !legacyToken) {
      return SCAN_AGAIN_MESSAGE;
    }
    return null;
  });

  const [items, setItems] = useState<PhoneUploadItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pairingInProgressRef = useRef<boolean>(false);

  // (a) Cliente WS para o telefone: auth primeiro, heartbeat a cada 10s, reconexão a cada 2s
  const {
    sessionClosed: wsSessionClosed,
    closedReason: wsClosedReason,
    reconnecting: wsReconnecting,
    connected: wsConnected,
  } = useSessionEvents(urlSessionId, credential, {
    role: "phone",
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
  const isComputerDisconnected =
    !isSessionClosed && !isReconnecting && remoteSession?.computerPresent === false;

  useEffect(() => {
    if (isSessionClosed && urlSessionId) {
      clearStoredSession(urlSessionId);
    }
  }, [isSessionClosed, urlSessionId]);

  // Consulta estado remoto (PAIRED, DISCONNECTED, CLOSED, computerPresent)
  useEffect(() => {
    if (!urlSessionId || !credential || isSessionClosed) return;

    let active = true;

    async function check() {
      try {
        const data = await getSession(urlSessionId, credential!);
        if (!active) return;
        setRemoteSession(data);
      } catch (err: any) {
        if (!active) return;
        if (err?.status === 410) {
          setRemoteSession((prev) => (prev ? { ...prev, state: "CLOSED" } : { id: urlSessionId, state: "CLOSED", fileCount: 0, createdAt: "" }));
          clearStoredSession(urlSessionId);
        }
      }
    }

    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [urlSessionId, credential, isSessionClosed]);

  useEffect(() => {
    if (credential || sessionError || !urlSessionId || !qrToken) {
      return;
    }
    if (pairingInProgressRef.current) {
      return;
    }

    pairingInProgressRef.current = true;
    let isCancelled = false;

    async function doPair() {
      setIsPairing(true);
      try {
        const data = await pairSession(urlSessionId, qrToken);
        const cred = data.phoneCredential;
        const vId = data.visualId || data.shortId || null;

        if (storageKey) {
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ phoneCredential: cred, visualId: vId })
            );
          } catch {
            // Ignore localStorage quota error
          }
        }

        if (isCancelled) return;
        setCredential(cred);
        setVisualId(vId);
        setIsPairing(false);

        if (typeof window !== "undefined" && window.history && window.history.replaceState) {
          try {
            window.history.replaceState({}, "", window.location.pathname);
          } catch {}
        }
      } catch (err: any) {
        pairingInProgressRef.current = false;
        if (isCancelled) return;
        setIsPairing(false);
        const status = err?.status;
        const code = err?.code;

        if (status === 410 || code === "CLOSED") {
          setSessionError("Sessão encerrada pelo computador.");
        } else if (status === 401 || status === 404 || code === "INVALID" || code === "NOT_FOUND") {
          setSessionError(SCAN_AGAIN_MESSAGE);
        } else if (status >= 500 && status < 600) {
          setSessionError("Servidor temporariamente indisponível.");
        } else if (!status || err?.name === "TypeError" || err?.message?.includes("fetch")) {
          setSessionError("Sem conexão com o servidor.");
        } else {
          setSessionError(err?.message || "Erro ao conectar à sessão.");
        }
      }
    }

    doPair();

    return () => {
      isCancelled = true;
      pairingInProgressRef.current = false;
    };
  }, [urlSessionId, qrToken, credential, sessionError, storageKey]);

  const uploadSingleFile = (item: PhoneUploadItem) => {
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
      } else if (xhr.status === 401) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Falha de autorização no envio" } : i))
        );
      } else if (xhr.status === 410) {
        setRemoteSession((prev) => (prev ? { ...prev, state: "CLOSED" } : { id: urlSessionId, state: "CLOSED", fileCount: 0, createdAt: "" }));
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

    xhr.open("POST", `${BASE_URL}/api/sessions/${urlSessionId}/files`);
    if (credential) {
      xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
    }
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

    const newItems: PhoneUploadItem[] = fileList.map((file) => ({
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

  // PUT replaces the file content keeping the same remote id: no new item.
  const replaceEditedImage = (item: PhoneUploadItem, file: File) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("files", file, file.name);
    const fail = (error: string) =>
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, error } : i)));

    xhr.onload = () => {
      if (xhr.status !== 200) {
        fail(xhr.status === 410 ? "Sessão encerrada" : xhr.status === 404 ? "Arquivo não encontrado" : `Erro ${xhr.status}`);
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
    xhr.open("PUT", `${BASE_URL}/api/sessions/${urlSessionId}/files/${item.remoteId}`);
    if (credential) {
      xhr.setRequestHeader("Authorization", `Bearer ${credential}`);
    }
    xhr.send(formData);
  };

  const leaveSession = () => {
    clearStoredSession(urlSessionId);
    setItems([]);
    setVisualId(null);
    setRemoteSession(null);
    setCredential(null);
    if (!qrToken) setSessionError(SCAN_AGAIN_MESSAGE);
  };

  const retryUpload = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) uploadSingleFile(item);
  };

  const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined;

  const totalFiles = items.length;
  const completedFiles = items.filter((i) => i.state === "completed").length;
  const isUploading = items.some(
    (i) => i.state === "uploading" || i.state === "pending" || i.state === "optimizing"
  );

  if (sessionError) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-[var(--color-error)] flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
              Sessão Indisponível
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {sessionError}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  if (isPairing) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mx-auto" />
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Conectando ao computador...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--color-bg)] max-w-md mx-auto">
      {/* Header */}
      <header className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone size={20} strokeWidth={1.5} className="text-[var(--color-accent)] shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm tracking-tight truncate">Enviar para Computador</span>
            {visualId && (
              <span
                data-testid="phone-visual-id"
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
          {wsConnected && !isSessionClosed && (
            <Button variant="ghost" size="sm" onClick={leaveSession}>
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

      {isComputerDisconnected && (
        <div
          data-testid="status-computer-disconnected"
          role="status"
          className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs font-medium text-[var(--color-error)] flex items-center justify-center gap-2"
        >
          <AlertCircle size={14} />
          <span>Computador desconectado</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 p-4 flex flex-col gap-4">
        {/* Big Tap Area */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={isSessionClosed}
          className="hidden"
          id="phone-file-input"
          onChange={handleFilesChosen}
        />

        <label
          htmlFor={isSessionClosed ? undefined : "phone-file-input"}
          className={[
            "border-2 border-dashed border-[var(--color-border)]",
            isSessionClosed
              ? "opacity-50 cursor-not-allowed bg-[var(--color-surface)]"
              : "hover:border-[var(--color-accent)] cursor-pointer bg-[var(--color-surface)] active:scale-[0.99]",
            "rounded-2xl p-8 flex flex-col items-center justify-center gap-3 transition-all min-h-[160px]",
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
        <div className="flex-1 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <UploadItem
              key={item.id}
              item={item}
              onRetry={retryUpload}
              onEdit={isSessionClosed ? undefined : setEditingId}
            />
          ))}
        </div>

        {/* Bottom Actions */}
        {totalFiles > 0 && !isUploading && (
          <div className="pt-2 sticky bottom-4">
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
      </main>

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
