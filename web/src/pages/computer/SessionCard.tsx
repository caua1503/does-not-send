import { useRef, useState, useEffect } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { X, Files, Maximize2 } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { StatusDot } from "../../components/ui/StatusDot.tsx";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { useHeartbeat } from "../../hooks/useHeartbeat.ts";
import { FileList } from "./FileList.tsx";
import { createPortal } from "react-dom";
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
  const [qrOpen, setQrOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const { files: localFiles, connected: localConnected } = useSessionEvents(
    session.id,
    session.ownerToken,
  );
  useHeartbeat(session.id, session.ownerToken);

  const files = externalFiles ?? localFiles;
  const connected = externalConnected ?? localConnected;

  const uploadUrl = `${publicBaseUrl}/enviar/${session.id}?token=${encodeURIComponent(session.uploadToken)}`;

  // Fecha com Esc
  useEffect(() => {
    if (!qrOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [qrOpen]);

  // Bloqueia scroll do body
  useEffect(() => {
    document.body.style.overflow = qrOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [qrOpen]);

  function openQr(e: React.MouseEvent) {
    e.stopPropagation();
    // Gera dataURL a partir do canvas oculto
    const canvas = canvasRef.current;
    if (canvas) {
      setQrDataUrl(canvas.toDataURL("image/png"));
    }
    setQrOpen(true);
  }

  function closeQr() {
    setQrOpen(false);
  }

  return (
    <>
      {/* Canvas oculto de alta resolução — fonte do dataURL */}
      <div style={{ position: "absolute", left: "-9999px", top: "-9999px", visibility: "hidden" }}>
        <QRCodeCanvas
          ref={canvasRef}
          value={uploadUrl}
          size={600}
          marginSize={4}
          level="H"
        />
      </div>

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
            onClick={openQr}
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
            <div className="absolute inset-0 bg-black/30 rounded-xl opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center justify-center transition-opacity text-white pointer-events-none">
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

      {/* Overlay com imagem do QR Code */}
      {qrOpen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR Code ampliado"
          style={{ position: "fixed", inset: 0, zIndex: 9999 }}
          className="flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          onClick={closeQr}
        >
          <div
            className="relative bg-white rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Botão fechar */}
            <button
              type="button"
              onClick={closeQr}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label="Fechar"
            >
              <X size={16} strokeWidth={1.75} />
            </button>

            <h2 className="text-sm font-semibold text-gray-800">
              QR Code para envio de arquivos
            </h2>

            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code para envio de arquivos"
                className="w-64 h-64 sm:w-72 sm:h-72 max-w-full"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <QRCodeSVG value={uploadUrl} size={280} marginSize={4} level="H" />
            )}

            <p className="text-xs text-gray-500 text-center">
              Aponte a câmera do telefone para o QR Code
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
