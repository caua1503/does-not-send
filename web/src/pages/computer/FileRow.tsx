import { useState } from "react";
import { Eye, Download, FileText, Image, Film, Music, File } from "lucide-react";
import { Modal } from "../../components/ui/Modal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ProgressBar } from "../../components/ui/ProgressBar.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { formatBytes, fileCategory, fileStateLabel } from "../../lib/format.ts";
import { previewUrl, downloadUrl } from "../../lib/api.ts";
import type { FileEntry } from "../../lib/api.ts";
import type { FileCategory } from "../../lib/format.ts";

interface FileRowProps {
  file: FileEntry;
  sessionId: string;
  ownerToken: string;
}

const categoryIcon: Record<FileCategory, typeof File> = {
  image: Image,
  video: Film,
  audio: Music,
  pdf: FileText,
  other: File,
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
  const category = fileCategory(file.mimeType, file.originalName);
  const Icon = categoryIcon[category];
  const preview = previewUrl(sessionId, file.id, ownerToken);
  const download = downloadUrl(sessionId, file.id, ownerToken);
  const canPreview =
    file.state === "completed" &&
    (category === "image" ||
      category === "video" ||
      category === "audio" ||
      category === "pdf");

  return (
    <>
      <div className="animate-slide-in flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-accent-light)]/40 transition-colors group">
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
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs tabular text-[var(--color-text-muted)]">
              {formatBytes(file.size)}
            </span>
            <Badge label={fileStateLabel(file.state)} variant={stateBadgeVariant[file.state]} />
          </div>
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
          {canPreview && (
            <button
              onClick={() => setPreviewOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              aria-label={`Pré-visualizar ${file.originalName}`}
            >
              <Eye size={16} strokeWidth={1.5} />
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
        onClose={() => setPreviewOpen(false)}
        file={file}
        category={category}
        previewSrc={preview}
        downloadSrc={download}
      />
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
}

function PreviewModal({
  open,
  onClose,
  file,
  category,
  previewSrc,
  downloadSrc,
}: PreviewModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={file.originalName}>
      <div className="p-4">
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
        {category === "other" && (
          <div className="py-12 flex flex-col items-center gap-4">
            <File size={48} strokeWidth={1.25} className="text-[var(--color-text-muted)]" />
            <p className="text-sm text-[var(--color-text-muted)]">{file.originalName}</p>
            <a href={downloadSrc} download={file.originalName}>
              <Button variant="primary" size="md">
                <Download size={16} strokeWidth={1.5} />
                Baixar arquivo
              </Button>
            </a>
          </div>
        )}
        {/* Download link always available */}
        <div className="mt-4 flex justify-end gap-2">
          <a href={downloadSrc} download={file.originalName}>
            <Button variant="ghost" size="sm">
              <Download size={14} strokeWidth={1.5} />
              Baixar
            </Button>
          </a>
        </div>
      </div>
    </Modal>
  );
}
