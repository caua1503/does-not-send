import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Files, Maximize2 } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
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
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const { files: localFiles, connected: localConnected } = useSessionEvents(
    session.id,
    session.ownerToken,
  );
  useHeartbeat(session.id, session.ownerToken);

  const files = externalFiles ?? localFiles;
  const connected = externalConnected ?? localConnected;

  const uploadUrl = `${publicBaseUrl}/enviar/${session.id}?token=${encodeURIComponent(session.uploadToken)}`;

  return (
    <>
      <Card
        className={[
          "overflow-hidden cursor-pointer transition-all",
          selected ? "ring-2 ring-[var(--color-accent)]" : "",
        ].join(" ")}
        onClick={onSelect}
      >
        <div className="p-4 flex items-start gap-4">
          {/* QR Code — always white background */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setQrModalOpen(true);
            }}
            className="group relative flex-shrink-0 bg-white p-2 rounded-xl border border-[var(--color-border)] hover:ring-2 hover:ring-[var(--color-accent)] transition-all cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            aria-label="Ampliar QR Code"
            title="Clique para ampliar o QR Code"
          >
            <QRCodeSVG
              value={uploadUrl}
              size={100}
              marginSize={2}
              level="M"
            />
            <div className="absolute inset-0 bg-black/30 rounded-xl opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center justify-center transition-opacity text-white">
              <Maximize2 size={22} strokeWidth={2} />
            </div>
          </button>

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

      {/* Modal QR Code ampliado */}
      <Modal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="QR Code para envio de arquivos"
      >
        <div className="p-6 flex flex-col items-center text-center">
          <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-[var(--color-border)] max-w-full">
            <QRCodeSVG
              value={uploadUrl}
              size={280}
              marginSize={4}
              level="M"
              className="w-56 h-56 sm:w-72 sm:h-72 max-w-full max-h-[60dvh]"
            />
          </div>
          <p className="mt-4 text-sm font-medium text-[var(--color-text)]">
            Aponte a câmera do telefone para o QR Code
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)] max-w-xs break-all">
            Abra a página de upload diretamente no seu dispositivo móvel conectado à rede local.
          </p>
        </div>
      </Modal>
    </>
  );
}
