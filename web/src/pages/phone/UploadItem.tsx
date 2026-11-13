import { CheckCircle2, RefreshCw, Loader2, File, FileText, Pencil } from "lucide-react";
import { formatBytes } from "../../lib/format.ts";
import { isEditableImage, byExtension } from "../../lib/editableImage.ts";
import { ProgressBar } from "../../components/ui/ProgressBar.tsx";

export interface PhoneUploadItem {
  id: string;
  file: File;
  progress: number; // 0 - 1
  state: "pending" | "optimizing" | "uploading" | "completed" | "error";
  error?: string;
  remoteId?: string;
  edited?: boolean;
  kind?: "text";
}

interface UploadItemProps {
  item: PhoneUploadItem;
  onRetry: (id: string) => void;
  onEdit?: (id: string) => void;
}

export function UploadItem({ item, onRetry, onEdit }: UploadItemProps) {
  // Some phones hand over an empty MIME: fall back to the file name.
  const editable = isEditableImage(item.file.type) || isEditableImage(byExtension(item.file.name));
  const canEdit = item.state === "completed" && Boolean(item.remoteId) && editable;  return (
    <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl animate-slide-in">
      <div className="w-10 h-10 rounded-lg bg-[var(--color-border)]/50 flex items-center justify-center flex-shrink-0">
        {item.kind === "text" ? (
          <FileText size={18} strokeWidth={1.5} className="text-[var(--color-text-muted)]" />
        ) : (
          <File size={18} strokeWidth={1.5} className="text-[var(--color-text-muted)]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--color-text)] truncate" title={item.file.name}>
            {item.file.name}
          </p>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {item.edited && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                editado
              </span>
            )}
            <span className="text-xs tabular text-[var(--color-text-muted)]">
              {formatBytes(item.file.size)}
            </span>
          </span>
        </div>

        {item.state === "optimizing" && (
          <p className="mt-1 text-xs text-[var(--color-accent)] font-medium">
            Otimizando...
          </p>
        )}

        {item.state === "uploading" && (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar value={item.progress} max={1} className="flex-1" />
            <span className="text-xs tabular text-[var(--color-text-muted)]">
              {Math.round(item.progress * 100)}%
            </span>
          </div>
        )}

        {item.state === "error" && (
          <p className="mt-1 text-xs text-[var(--color-error)] truncate">
            {item.error || "Falha no envio"}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(item.id)}
            className="p-1 rounded-lg hover:bg-[var(--color-border)] text-[var(--color-text-muted)]"
            aria-label={`Editar ${item.file.name}`}
          >
            <Pencil size={16} strokeWidth={1.75} />
          </button>
        )}
        {(item.state === "uploading" || item.state === "optimizing") && (
          <Loader2 size={18} className="animate-spin text-[var(--color-accent)]" />
        )}
        {item.state === "completed" && (
          <CheckCircle2 size={18} className="text-[var(--color-success)]" />
        )}
        {item.state === "error" && (
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            className="p-1 rounded-lg hover:bg-[var(--color-border)] text-[var(--color-error)]"
            title="Tentar novamente"
            aria-label={`Tentar novamente envio de ${item.file.name}`}
          >
            <RefreshCw size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}
