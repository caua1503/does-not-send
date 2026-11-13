import { useEffect, useRef, useState } from "react";
import { Eye, Download, FileText, Image, Film, Music, File as FileIcon, Pencil, AlignLeft, Copy, Check } from "lucide-react";
import { ImageEditor } from "../../components/ImageEditor/ImageEditor.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ProgressBar } from "../../components/ui/ProgressBar.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { formatBytes, fileCategory, fileStateLabel } from "../../lib/format.ts";
import { previewUrl, downloadUrl } from "../../lib/api.ts";
import { editedImageName, isEditableImage } from "../../lib/editableImage.ts";
import { copyText } from "../../lib/clipboard.ts";
import type { FileEntry } from "../../lib/api.ts";
import type { FileCategory } from "../../lib/format.ts";

interface FileRowProps {
  file: FileEntry;
  sessionId: string;
  ownerToken: string;
}

const categoryIcon: Record<FileCategory, typeof FileIcon> = {
  image: Image,
  video: Film,
  audio: Music,
  pdf: FileText,
  other: FileIcon,
};

const stateBadgeVariant: Record<
  FileEntry["state"],
  "neutral" | "success" | "warn" | "error"
> = {
  receiving: "warn",
  completed: "success",
  failed: "error",
};

export function FileRow({ file, sessionId, ownerToken }: FileRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [selectOnOpen, setSelectOnOpen] = useState(false);
  const isText = file.kind === "text";
  const category = fileCategory(file.mimeType, file.originalName);
  const Icon = isText ? AlignLeft : categoryIcon[category];
  const preview = previewUrl(sessionId, file.id, ownerToken, file.version);
  const download = downloadUrl(sessionId, file.id, ownerToken, file.version);
  const canPreview =
    file.state === "completed" &&
    (isText ||
      category === "image" ||
      category === "video" ||
      category === "audio" ||
      category === "pdf");
  const rowOpensPreview = file.state === "completed" && (isText || category === "image");
  const canEdit = file.state === "completed" && isEditableImage(file.mimeType);

  useEffect(() => {
    if (!isText || file.state !== "completed") return;
    let cancelled = false;
    setTextError(null);
    fetch(download, { headers: { Accept: "text/plain" } })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!cancelled) setTextContent(text);
      })
      .catch(() => {
        if (cancelled) return;
        setTextContent(null);
        setTextError("Não foi possível carregar o texto");
      });
    return () => {
      cancelled = true;
    };
  }, [isText, file.state, download]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (textContent === null) return;
    const ok = await copyText(textContent);
    setCopyError(ok ? null : "Não foi possível copiar");
    setCopied(ok);
    if (!ok) {
      setSelectOnOpen(true);
      setPreviewOpen(true);
    }
  };
  const openPreview = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setPreviewOpen(true);
  };
  const startEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditError(null);
    try {
      const res = await fetch(download);
      if (!res.ok) throw new Error(`Falha ao baixar imagem: ${res.status}`);
      const blob = await res.blob();
      setEditFile(new File([blob], file.originalName, { type: file.mimeType || blob.type }));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Falha ao baixar imagem");
    }
  };
  const saveEdit = (edited: File) => {
    setEditFile(null);
    const url = URL.createObjectURL(edited);
    const a = document.createElement("a");
    a.href = url;
    a.download = editedImageName(file.originalName);
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPreview();
    }
  };

  return (
    <>
      <div
        onClick={rowOpensPreview ? openPreview : undefined}
        onKeyDown={rowOpensPreview ? handleRowKeyDown : undefined}
        role={rowOpensPreview ? "button" : undefined}
        tabIndex={rowOpensPreview ? 0 : undefined}
        className={`animate-slide-in flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-accent-light)]/40 transition-colors group${rowOpensPreview ? " cursor-pointer" : ""}`}
      >
        {/* Thumbnail / Icon */}
        <div className="flex-shrink-0 w-10 h-10 rounded-xl overflow-hidden bg-[var(--color-border)] flex items-center justify-center">
          {category === "image" && file.state === "completed" ? (
            <img
              src={preview}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <Icon size={18} strokeWidth={1.5} className="text-[var(--color-text-muted)]" />
          )}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)] truncate" title={file.originalName}>
            {file.originalName}
          </p>
          {isText && textContent !== null && (
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)] whitespace-pre-wrap break-words line-clamp-3">
              {textContent}
            </p>
          )}
          {isText && textError && (
            <p className="mt-0.5 text-xs text-[var(--color-error)]" role="alert">
              {textError}
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs tabular text-[var(--color-text-muted)]">
              {formatBytes(file.size)}
            </span>
            <Badge label={fileStateLabel(file.state)} variant={stateBadgeVariant[file.state]} />
          </div>
          {editError && (
            <p className="mt-0.5 text-xs text-[var(--color-error)]" role="alert">
              {editError}
            </p>
          )}
          {copyError && (
            <p className="mt-0.5 text-xs text-[var(--color-error)]" role="alert">
              {copyError}
            </p>
          )}
          {file.state === "receiving" && (
            <ProgressBar
              value={file.bytesReceived}
              max={file.size}
              className="mt-1.5"
              label={`Recebendo ${file.originalName}`}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isText && textContent !== null && (
            <button
              onClick={copy}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              aria-label={copied ? "Copiado!" : `Copiar ${file.originalName}`}
            >
              {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
            </button>
          )}
          {canPreview && (
            <button
              onClick={openPreview}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              aria-label={`Pré-visualizar ${file.originalName}`}
            >
              <Eye size={16} strokeWidth={1.5} />
            </button>
          )}
          {canEdit && (
            <button
              onClick={startEdit}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              aria-label={`Editar ${file.originalName}`}
            >
              <Pencil size={16} strokeWidth={1.5} />
            </button>
          )}
          {file.state === "completed" && (
            <a
              href={download}
              download={file.originalName}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              aria-label={`Baixar ${file.originalName}`}
            >
              <Download size={16} strokeWidth={1.5} />
            </a>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      <PreviewModal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setSelectOnOpen(false);
        }}
        file={file}
        category={category}
        previewSrc={preview}
        downloadSrc={download}
        text={isText ? textContent : null}
        textError={isText ? textError : null}
        selectOnOpen={selectOnOpen}
      />

      {editFile && (
        <ImageEditor file={editFile} onSave={saveEdit} onCancel={() => setEditFile(null)} />
      )}
    </>
  );
}

interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  file: FileEntry;
  category: FileCategory;
  previewSrc: string;
  downloadSrc: string;
  text: string | null;
  textError?: string | null;
  selectOnOpen?: boolean;
}

function selectNodeContents(el: HTMLElement | null) {
  if (!el) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

function PreviewModal({
  open,
  onClose,
  file,
  category,
  previewSrc,
  downloadSrc,
  text,
  textError = null,
  selectOnOpen = false,
}: PreviewModalProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open || !selectOnOpen || text === null) return;
    const timer = window.setTimeout(() => selectNodeContents(preRef.current), 0);
    return () => window.clearTimeout(timer);
  }, [open, selectOnOpen, text]);

  const copy = async () => {
    if (text === null) return;
    const ok = await copyText(text);
    setCopied(ok);
    setCopyError(ok ? null : "Não foi possível copiar");
    if (!ok) selectNodeContents(preRef.current);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file.originalName}
      fullscreenOnMobile={file.kind === "text"}
    >
      <div className="p-4">
        {file.kind === "text" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs tabular text-[var(--color-text-muted)]">
                {formatBytes(file.size)}
              </span>
              <Button
                variant="ghost"
                size="md"
                onClick={copy}
                aria-label={copied ? "Copiado!" : "Copiar texto"}
              >
                {copied ? (
                  <Check size={16} strokeWidth={1.75} />
                ) : (
                  <Copy size={16} strokeWidth={1.75} />
                )}
                {copied ? "Copiado!" : "Copiar"}
              </Button>
              <a href={downloadSrc} download={file.originalName}>
                <Button variant="ghost" size="md">
                  <Download size={16} strokeWidth={1.75} />
                  Baixar .txt
                </Button>
              </a>
              <Button variant="ghost" size="md" onClick={onClose}>
                Fechar
              </Button>
            </div>
            {copyError && (
              <p className="text-xs text-[var(--color-error)]" role="alert">
                {copyError}
              </p>
            )}
            <pre
              ref={preRef}
              tabIndex={0}
              onDoubleClick={() => selectNodeContents(preRef.current)}
              aria-label={`Conteúdo de ${file.originalName}`}
              className="font-mono text-sm text-[var(--color-text)] whitespace-pre-wrap break-words overflow-y-auto overflow-x-hidden max-h-[60dvh] p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]"
            >
              {text ?? textError ?? "Carregando..."}
            </pre>
          </div>
        )}
        {category === "image" && (
          <img
            src={previewSrc}
            alt={file.originalName}
            className="max-w-full max-h-[60dvh] object-contain mx-auto rounded-xl"
          />
        )}
        {category === "video" && (
          <video
            src={previewSrc}
            controls
            className="max-w-full max-h-[60dvh] mx-auto rounded-xl"
          />
        )}
        {category === "audio" && (
          <div className="py-8 flex justify-center">
            <audio src={previewSrc} controls className="w-full max-w-md" />
          </div>
        )}
        {category === "pdf" && (
          <iframe
            src={previewSrc}
            title={file.originalName}
            sandbox=""
            className="w-full h-[60dvh] rounded-xl border border-[var(--color-border)]"
          />
        )}
        {category === "other" && file.kind !== "text" && (
          <div className="py-12 flex flex-col items-center gap-4">
            <FileIcon size={48} strokeWidth={1.25} className="text-[var(--color-text-muted)]" />
            <p className="text-sm text-[var(--color-text-muted)]">{file.originalName}</p>
            <a href={downloadSrc} download={file.originalName}>
              <Button variant="primary" size="md">
                <Download size={16} strokeWidth={1.5} />
                Baixar arquivo
              </Button>
            </a>
          </div>
        )}
        {file.kind !== "text" && (
          <div className="mt-4 flex justify-end gap-2">
            <a href={downloadSrc} download={file.originalName}>
              <Button variant="ghost" size="sm">
                <Download size={14} strokeWidth={1.5} />
                Baixar
              </Button>
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}
