import { useState, type KeyboardEvent } from "react";
import { Files, Download } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { FileRow } from "./FileRow.tsx";
import { FilePreview } from "./FilePreview.tsx";
import { fileCategory } from "../../lib/format.ts";
import { previewUrl, downloadUrl, zipUrl } from "../../lib/api.ts";
import type { FileEntry } from "../../lib/api.ts";

interface FileListProps {
  files: FileEntry[];
  sessionId: string;
  ownerToken: string;
  canDelete?: (file: FileEntry) => boolean;
  onDelete?: (file: FileEntry) => void;
}

export function FileList({
  files,
  sessionId,
  ownerToken,
  canDelete,
  onDelete,
}: FileListProps) {
  const [preview, setPreview] = useState<{ id: string; open: boolean; selectText?: boolean } | null>(null);
  const completed = files.filter((file) => file.state === "completed");
  const previewIndex = completed.findIndex((file) => file.id === preview?.id);
  const previewFile = completed[previewIndex];
  const completedCount = completed.length;

  const showPreview = (file: FileEntry, selectText = false) => {
    setPreview({ id: file.id, open: true, selectText });
  };

  const focusAdjacentRow = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const previous = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!previous && event.key !== "ArrowDown" && event.key !== "ArrowRight") return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-file-row]");
    if (!row || row.parentElement !== event.currentTarget) return;
    const adjacent = previous ? row.previousElementSibling : row.nextElementSibling;
    event.preventDefault();
    if (adjacent instanceof HTMLElement && adjacent.hasAttribute("data-file-row")) adjacent.focus();
  };

  const previousFile = completed[previewIndex - 1];
  const nextFile = completed[previewIndex + 1];

  if (files.length === 0) {
    return (
      <EmptyState
        icon={Files}
        title="Nenhum arquivo recebido"
        description="Os arquivos recebidos aparecerão aqui em tempo real."
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <span className="text-sm text-[var(--color-text-muted)]">
          {files.length} arquivo{files.length !== 1 ? "s" : ""}
          {completedCount > 0 && ` · ${completedCount} concluído${completedCount !== 1 ? "s" : ""}`}
        </span>
        {completedCount > 0 && (
          <a href={zipUrl(sessionId, ownerToken)} download>
            <Button variant="ghost" size="sm">
              <Download size={14} strokeWidth={1.5} />
              Baixar tudo (ZIP)
            </Button>
          </a>
        )}
      </div>

      {/* File rows */}
      <div className="flex-1 overflow-y-auto" onKeyDown={focusAdjacentRow}>
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            sessionId={sessionId}
            ownerToken={ownerToken}
            onPreview={(selectText) => showPreview(file, selectText)}
            canDelete={canDelete?.(file)}
            onDelete={onDelete}
          />
        ))}
      </div>
      {previewFile && preview && (
        <FilePreview
          open={preview.open}
          onClose={() => setPreview({ ...preview, open: false })}
          file={previewFile}
          category={fileCategory(previewFile.mimeType, previewFile.originalName)}
          previewSrc={previewUrl(sessionId, previewFile.id, ownerToken, previewFile.version)}
          downloadSrc={downloadUrl(sessionId, previewFile.id, ownerToken, previewFile.version)}
          selectOnOpen={preview.selectText}
          onPrevious={previousFile ? () => showPreview(previousFile) : undefined}
          onNext={nextFile ? () => showPreview(nextFile) : undefined}
        />
      )}
    </div>
  );
}
