import { useState, useEffect, useCallback } from "react";
import { Plus, Monitor } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Toast } from "../../components/ui/Toast.tsx";
import { SessionCard } from "./SessionCard.tsx";
import { FileList } from "./FileList.tsx";
import { createSession, deleteSession } from "../../lib/api.ts";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import type { Session } from "../../lib/api.ts";

declare const __BASE_URL__: string;
const PUBLIC_BASE_URL =
  typeof __BASE_URL__ !== "undefined" && __BASE_URL__ ? __BASE_URL__ : window.location.origin;

interface ActiveSession extends Session {
  closing?: boolean;
}

export default function ComputerPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "error" | "info" } | null>(null);

  const selectedSession = sessions.find((s) => s.id === selectedId);

  // Auto-select first session
  useEffect(() => {
    if (sessions.length > 0 && !selectedId) {
      setSelectedId(sessions[0]!.id);
    }
    if (sessions.length === 0) {
      setSelectedId(null);
    }
  }, [sessions, selectedId]);

  const handleNewSession = async () => {
    setCreating(true);
    try {
      const s = await createSession();
      setSessions((prev) => [...prev, s]);
      setSelectedId(s.id);
    } catch {
      setToast({ message: "Não foi possível criar a sessão. Tente novamente.", type: "error" });
    } finally {
      setCreating(false);
    }
  };

  const handleCloseSession = useCallback(async (session: ActiveSession) => {
    setSessions((prev) => prev.filter((s) => s.id !== session.id));
    if (selectedId === session.id) setSelectedId(null);
    try {
      await deleteSession(session.id, session.ownerToken);
    } catch {
      // Best-effort — session will expire via timeout anyway
    }
  }, [selectedId]);

  // pagehide: best-effort cleanup via sendBeacon (no custom headers)
  useEffect(() => {
    const handlePageHide = () => {
      for (const session of sessions) {
        const url = `${PUBLIC_BASE_URL}/api/sessions/${session.id}?token=${encodeURIComponent(session.ownerToken)}`;
        // sendBeacon with DELETE not directly supported — use fetch with keepalive
        navigator.sendBeacon(url);
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [sessions]);

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={20} strokeWidth={1.5} className="text-[var(--color-accent)]" />
            <span className="text-base font-semibold tracking-tight">does not send</span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleNewSession}
            disabled={creating}
            aria-label="Nova sessão"
          >
            <Plus size={16} strokeWidth={1.75} />
            Nova sessão
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center mt-12">
            <EmptyState
              icon={Monitor}
              title="Nenhuma sessão ativa"
              description="Crie uma sessão e escaneie o QR Code com o seu telefone para enviar arquivos."
              action={
                <Button
                  variant="primary"
                  onClick={handleNewSession}
                  disabled={creating}
                >
                  <Plus size={16} strokeWidth={1.75} />
                  Nova sessão
                </Button>
              }
            />
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 h-[calc(100dvh-130px)]">
            {/* Sessions panel */}
            <aside className="lg:w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  publicBaseUrl={PUBLIC_BASE_URL}
                  selected={session.id === selectedId}
                  onSelect={() => setSelectedId(session.id)}
                  onClose={() => handleCloseSession(session)}
                />
              ))}
            </aside>

            {/* Files panel */}
            <section className="flex-1 hidden lg:flex flex-col">
              {selectedSession ? (
                <Card className="flex-1 overflow-hidden flex flex-col">
                  <SelectedSessionFiles session={selectedSession} />
                </Card>
              ) : (
                <Card className="flex-1">
                  <EmptyState
                    icon={Monitor}
                    title="Selecione uma sessão"
                    description="Clique em uma sessão para ver os arquivos recebidos."
                  />
                </Card>
              )}
            </section>
          </div>
        )}
      </main>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

function SelectedSessionFiles({ session }: { session: ActiveSession }) {
  const { files } = useSessionEvents(session.id, session.ownerToken);
  return <FileList files={files} sessionId={session.id} ownerToken={session.ownerToken} />;
}
