import { QRCodeSVG } from "qrcode.react";
import { X, Files } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { StatusDot } from "../../components/ui/StatusDot.tsx";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { useHeartbeat } from "../../hooks/useHeartbeat.ts";
import { FileList } from "./FileList.tsx";
import type { FileEntry } from "../../lib/api.ts";

interface ActiveSession {
  id: string;
  ownerToken: string;
  uploadToken: string;
}

interface SessionCardProps {
  session: ActiveSession;
  publicBaseUrl: string;
  onClose: () => void;
  selected: boolean;
  onSelect: () => void;
  // files can also be passed from parent for single-session view
  externalFiles?: FileEntry[];
  externalConnected?: boolean;
}

export function SessionCard({
  session,
  publicBaseUrl,
  onClose,
  selected,
  onSelect,
  externalFiles,
  externalConnected,
}: SessionCardProps) {
  const { files: localFiles, connected: localConnected } = useSessionEvents(
    session.id,
    session.ownerToken,
  );
  useHeartbeat(session.id, session.ownerToken);

  const files = externalFiles ?? localFiles;
  const connected = externalConnected ?? localConnected;

  const uploadUrl = `${publicBaseUrl}/enviar/${session.id}?token=${encodeURIComponent(session.uploadToken)}`;

  return (
    <Card
      className={[
        "overflow-hidden cursor-pointer transition-all",
        selected ? "ring-2 ring-[var(--color-accent)]" : "",
      ].join(" ")}
      onClick={onSelect}
    >
      <div className="p-4 flex items-start gap-4">
        {/* QR Code — always white background */}
        <div className="flex-shrink-0 bg-white p-2 rounded-xl">
          <QRCodeSVG
            value={uploadUrl}
            size={100}
            marginSize={2}
            level="M"
          />
        </div>

        {/* Session info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <StatusDot connected={connected} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              aria-label="Encerrar sessão"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
            <Files size={14} strokeWidth={1.5} />
            <span className="tabular">
              {files.length} arquivo{files.length !== 1 ? "s" : ""}
            </span>
          </div>

          <p className="mt-2 text-xs text-[var(--color-text-muted)] break-all leading-relaxed">
            Escaneie o QR Code com o telefone
          </p>
        </div>
      </div>

      {/* File list inline (for selected session) */}
      {selected && files.length > 0 && (
        <div className="border-t border-[var(--color-border)] max-h-64 overflow-hidden lg:hidden">
          <FileList files={files} sessionId={session.id} ownerToken={session.ownerToken} />
        </div>
      )}
    </Card>
  );
}
