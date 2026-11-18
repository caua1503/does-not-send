import { useEffect, useState } from "react";
import { Eye, Download, FileText, Image, Film, Music, File as FileIcon, Pencil, AlignLeft, Copy, Check, Trash2, Monitor, Smartphone } from "lucide-react";
import { ImageEditor } from "../../components/ImageEditor/ImageEditor.tsx";
import { FilePreview } from "./FilePreview.tsx";
import { useFileText } from "./useFileText.ts";
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
  onPreview?: (selectText?: boolean) => void;
  canDelete?: boolean;
  onDelete?: (file: FileEntry) => void;
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

export function FileRow({ file, sessionId, ownerToken, onPreview, canDelete, onDelete }: FileRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [selectOnOpen, setSelectOnOpen] = useState(false);
  const isText = file.kind === "text";
  const category = fileCategory(file.mimeType, file.originalName);
  const Icon = isText ? AlignLeft : categoryIcon[category];
  const preview = previewUrl(sessionId, file.id, ownerToken, file.version);
  const download = downloadUrl(sessionId, file.id, ownerToken, file.version);
  const loadedText = useFileText(download, isText && file.state === "completed");
  const { textContent, textError } = loadedText;
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
      showPreview(true);
    }
  };
  const showPreview = (selectText = false) => {
    if (onPreview) {
      onPreview(selectText);
      return;
    }
    setSelectOnOpen(selectText);
    setPreviewOpen(true);
  };
  const openPreview = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    showPreview();
  };
  const remove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(file);
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
    if (e.target !== e.currentTarget || file.state !== "completed") return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPreview();
    }
  };

  return (
    <>
      <div
        onClick={rowOpensPreview ? openPreview : undefined}
        onKeyDown={rowOpensPreview || onPreview ? handleRowKeyDown : undefined}
        role={rowOpensPreview ? "button" : undefined}
        data-file-row={file.id}
        tabIndex={rowOpensPreview || onPreview ? 0 : undefined}
        className={`focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)] animate-slide-in flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-accent-light)]/40 transition-colors group${rowOpensPreview ? " cursor-pointer" : ""}`}
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
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <span className="text-xs tabular text-[var(--color-text-muted)]">
              {formatBytes(file.size)}
            </span>
            <Badge label={fileStateLabel(file.state)} variant={stateBadgeVariant[file.state]} />
            {file.senderName && (
              <span
                className="inline-flex items-center gap-1 min-w-0 text-xs text-[var(--color-text-muted)]"
                title={`Enviado por ${file.senderName}`}
              >
                {file.origin === "desktop" ? (
                  <Monitor size={12} strokeWidth={1.5} className="shrink-0" />
                ) : (
                  <Smartphone size={12} strokeWidth={1.5} className="shrink-0" />
                )}
                <span className="truncate max-w-32">{file.senderName}</span>
              </span>
            )}
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
          {canDelete && onDelete && (
            <button
              onClick={remove}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-border)] transition-colors"
              aria-label={`Apagar ${file.originalName}`}
            >
              <Trash2 size={16} strokeWidth={1.5} />
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
      {!onPreview && (
        <FilePreview
          open={previewOpen}
          onClose={() => {
            setPreviewOpen(false);
            setSelectOnOpen(false);
          }}
          file={file}
          category={category}
          previewSrc={preview}
          downloadSrc={download}
          loadedText={loadedText}
          selectOnOpen={selectOnOpen}
        />
      )}

      {editFile && (
        <ImageEditor file={editFile} onSave={saveEdit} onCancel={() => setEditFile(null)} />
      )}
    </>
  );
}
