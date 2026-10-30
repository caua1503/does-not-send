import { Files, Download } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { FileRow } from "./FileRow.tsx";
import { zipUrl } from "../../lib/api.ts";
import type { FileEntry } from "../../lib/api.ts";

interface FileListProps {
  files: FileEntry[];
  sessionId: string;
  ownerToken: string;
}

export function FileList({ files, sessionId, ownerToken }: FileListProps) {
  const completedCount = files.filter((f) => f.state === "completed").length;

  if (files.length === 0) {
    return (
      <EmptyState
        icon={Files}
        title="Nenhum arquivo recebido"
        description="Os arquivos enviados pelo telefone aparecerão aqui em tempo real."
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
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            sessionId={sessionId}
            ownerToken={ownerToken}
          />
        ))}
      </div>
    </div>
  );
}
