import { useState, useRef } from "react";
import { Upload, Smartphone, AlertCircle, Plus } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ProgressBar } from "../../components/ui/ProgressBar.tsx";
import { UploadItem, type PhoneUploadItem } from "./UploadItem.tsx";

declare const __BASE_URL__: string;
const BASE = typeof __BASE_URL__ !== "undefined" ? __BASE_URL__ : "";

interface PhonePageProps {
  sessionId?: string;
  token?: string;
}

export default function PhonePage({ sessionId: propSessionId, token: propToken }: PhonePageProps) {
  // Extract from props or URL
  const pathParts = window.location.pathname.split("/");
  const urlSessionId = propSessionId || pathParts[2] || "";
  const searchParams = new URLSearchParams(window.location.search);
  const token = propToken || searchParams.get("token") || "";

  const [items, setItems] = useState<PhoneUploadItem[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(
    !urlSessionId || !token ? "Sessão inválida ou link expirado." : null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadSingleFile = (item: PhoneUploadItem) => {
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
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "completed", progress: 1 } : i))
        );
      } else if (xhr.status === 401) {
        setSessionError("Sessão inválida ou já encerrada pelo computador.");
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Sessão expirada" } : i))
        );
      } else if (xhr.status === 413) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Arquivo muito grande ou limite excedido" } : i))
        );
      } else {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: `Erro ${xhr.status}` } : i))
        );
      }
    };

    xhr.onerror = () => {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, state: "error", error: "Falha de rede" } : i))
      );
    };

    xhr.open("POST", `${BASE}/api/sessions/${urlSessionId}/files`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  };

  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const fileList = Array.from(e.target.files);

    const newItems: PhoneUploadItem[] = fileList.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      progress: 0,
      state: "pending",
    }));

    setItems((prev) => [...prev, ...newItems]);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Trigger upload for all new items
    newItems.forEach((item) => uploadSingleFile(item));
  };

  const retryUpload = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) uploadSingleFile(item);
  };

  const totalFiles = items.length;
  const completedFiles = items.filter((i) => i.state === "completed").length;
  const isUploading = items.some((i) => i.state === "uploading" || i.state === "pending");

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

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--color-bg)] max-w-md mx-auto">
      {/* Header */}
      <header className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Smartphone size={20} strokeWidth={1.5} className="text-[var(--color-accent)]" />
          <span className="font-semibold text-sm tracking-tight">Enviar para Computador</span>
        </div>
        <span className="text-xs text-[var(--color-text-muted)] tabular">
          {completedFiles}/{totalFiles} enviados
        </span>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-4 flex flex-col gap-4">
        {/* Big Tap Area */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          id="phone-file-input"
          onChange={handleFilesChosen}
        />

        <label
          htmlFor="phone-file-input"
          className={[
            "border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)]",
            "rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer",
            "bg-[var(--color-surface)] active:scale-[0.99] transition-all min-h-[160px]",
          ].join(" ")}
        >
          <div className="w-12 h-12 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center text-[var(--color-accent)]">
            <Upload size={24} strokeWidth={1.75} />
          </div>
          <div className="text-center">
            <span className="font-semibold text-base text-[var(--color-text)]">
              Escolher arquivos
            </span>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Fotos, vídeos e documentos
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
            <UploadItem key={item.id} item={item} onRetry={retryUpload} />
          ))}
        </div>

        {/* Bottom Actions */}
        {totalFiles > 0 && !isUploading && (
          <div className="pt-2 sticky bottom-4">
            <Button
              variant="primary"
              size="lg"
              className="w-full shadow-lg"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={18} strokeWidth={2} />
              Enviar mais arquivos
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
