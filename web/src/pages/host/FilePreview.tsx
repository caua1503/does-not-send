import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download, File as FileIcon } from "lucide-react";
import { Modal } from "../../components/ui/Modal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { copyText } from "../../lib/clipboard.ts";
import { formatBytes, type FileCategory } from "../../lib/format.ts";
import type { FileEntry } from "../../lib/api.ts";
import { useFileText } from "./useFileText.ts";

interface FilePreviewProps {
  open: boolean;
  onClose: () => void;
  file: FileEntry;
  category: FileCategory;
  previewSrc: string;
  downloadSrc: string;
  loadedText?: { textContent: string | null; textError: string | null };
  onPrevious?: () => void;
  onNext?: () => void;
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

export function FilePreview({
  open,
  onClose,
  file,
  category,
  previewSrc,
  downloadSrc,
  loadedText,
  onPrevious,
  onNext,
  selectOnOpen = false,
}: FilePreviewProps) {
  const fetchedText = useFileText(downloadSrc, open && file.kind === "text" && !loadedText);
  const { textContent: text, textError } = loadedText ?? fetchedText;
  const navigate = onPrevious || onNext;
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [file.id]);

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
      onKeyDown={navigate ? (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest("audio, video, input, textarea, select, [contenteditable=true]")) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "ArrowLeft") onPrevious?.();
        else onNext?.();
      } : undefined}
      footer={navigate && (
        <div className="flex gap-2" aria-label="Navegação da prévia" role="group">
          <Button variant="ghost" size="sm" onClick={onPrevious} aria-disabled={!onPrevious} aria-keyshortcuts="ArrowLeft">
            <ChevronLeft size={16} aria-hidden="true" /> Anterior
          </Button>
          <Button variant="ghost" size="sm" onClick={onNext} aria-disabled={!onNext} aria-keyshortcuts="ArrowRight">
            Próximo <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
    >
      <div key={file.id} className="p-4">
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
