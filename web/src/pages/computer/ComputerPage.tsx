import { useState, useEffect, useCallback } from "react";
import { Plus, Monitor, KeyRound } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Toast } from "../../components/ui/Toast.tsx";
import { SessionCard } from "./SessionCard.tsx";
import { FileList } from "./FileList.tsx";
import { createSession, deleteSession, joinWithCode, JoinError } from "../../lib/api.ts";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import type { Session } from "../../lib/api.ts";
import { BASE_URL } from "../../lib/base.ts";
import { JoinSessionForm } from "../phone/JoinSessionForm.tsx";
import { APP_VERSION } from "../../lib/whatsNew.ts";

const PUBLIC_BASE_URL = BASE_URL || window.location.origin;

interface ActiveSession extends Session {
  closing?: boolean;
}

export default function ComputerPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
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

  // Session no longer exists server-side (restart/expiry): drop it, tell the user
  const handleSessionExpired = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setSelectedId((prev) => (prev === sessionId ? null : prev));
    setToast({ message: "Sessão encerrada", type: "info" });
  }, []);

  // pagehide: best-effort cleanup via sendBeacon (no custom headers)
  useEffect(() => {
    const handlePageHide = () => {
      for (const session of sessions) {
        const url = `${PUBLIC_BASE_URL}/api/sessions/${encodeURIComponent(session.id)}?token=${encodeURIComponent(session.ownerToken)}`;
        // sendBeacon with DELETE not directly supported — use fetch with keepalive
        navigator.sendBeacon(url);
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [sessions]);

  // Manual login from the home screen: same credential the QR pairs give, then
  // hand off to the phone page with the canonical id.
  const handleJoinWithCode = async (sessionId: string, code: string) => {
    try {
      const data = await joinWithCode(sessionId, code);
      try {
        localStorage.setItem(
          `dns_phone_cred_${data.sessionId}`,
          JSON.stringify({ phoneCredential: data.phoneCredential }),
        );
      } catch {}
      window.location.assign(`/enviar/${data.sessionId}`);
      return null;
    } catch (err) {
      if (err instanceof JoinError && err.status === 429) {
        return "Muitas tentativas, aguarde um pouco";
      }
      return "ID ou código inválido ou expirado";
    }
  };

  if (joining) {
    return <JoinSessionForm onSubmit={handleJoinWithCode} onCancel={() => setJoining(false)} />;
  }

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={20} strokeWidth={1.5} className="text-[var(--color-accent)]" />
            <span className="text-base font-semibold tracking-tight">does not send</span>
            <span className="text-[11px] text-[var(--color-text-muted)] tabular shrink-0">
              v{APP_VERSION}
            </span>
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
                <div className="flex flex-col gap-2 w-48">
                  <Button
                    variant="primary"
                    onClick={handleNewSession}
                    disabled={creating}
                  >
                    <Plus size={16} strokeWidth={1.75} />
                    Nova sessão
                  </Button>
                  <Button variant="ghost" onClick={() => setJoining(true)}>
                    <KeyRound size={16} strokeWidth={1.75} />
                    Entrar com código
                  </Button>
                </div>
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
                  onExpired={() => handleSessionExpired(session.id)}
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
