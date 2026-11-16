import { useState, useEffect, useCallback } from "react";
import { Plus, Monitor, KeyRound, Users } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Toast } from "../../components/ui/Toast.tsx";
import { LeaveSessionModal } from "../../components/LeaveSessionModal.tsx";
import { SessionCard } from "./SessionCard.tsx";
import { SessionPage } from "../SessionPage.tsx";
import {
  ApiError,
  createSession,
  deleteSession,
  joinTwowaySession,
  joinWithCode,
  JoinError,
  leaveSession,
} from "../../lib/api.ts";
import type { Session } from "../../lib/api.ts";
import { BASE_URL } from "../../lib/base.ts";
import { JoinSessionForm } from "../guest/JoinSessionForm.tsx";
import { detectDevice } from "../../lib/device.ts";
import { writeGuestSession } from "../../lib/guestSessionStorage.ts";
import { writeTwowaySession } from "../../lib/twowaySessionStorage.ts";
import { APP_VERSION } from "../../lib/whatsNew.ts";
import { TwowayNamePage } from "../twoway/TwowayNamePage.tsx";
import { TwowayRoomPage } from "../twoway/TwowayRoomPage.tsx";

const PUBLIC_BASE_URL = BASE_URL || window.location.origin;

interface ActiveSession extends Session {
  closing?: boolean;
}

export default function HostPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [pendingTwowayJoin, setPendingTwowayJoin] = useState<{
    id: string;
    code: string;
  } | null>(null);
  const [namingTwoway, setNamingTwoway] = useState(false);
  const [twowaySession, setTwowaySession] = useState<Session | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "error" | "info" } | null>(null);

  const selectedSession = sessions.find((s) => s.id === selectedId);
  const hasActiveSession = sessions.length > 0;

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

  const handleCreateTwoway = async (name: string): Promise<string | null> => {
    setCreating(true);
    try {
      const session = await createSession({ mode: "twoway", name, device: "desktop" });
      setNamingTwoway(false);
      setTwowaySession(session);
      return null;
    } catch {
      return "Não foi possível criar a sessão de troca. Tente novamente.";
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

  const goHome = () => {
    if (!hasActiveSession) return;
    setConfirmLeave(true);
  };

  // Host exit is server-first: only drop local state after the server
  // confirms the session (and its files) are gone.
  const leaveActiveSessions = async () => {
    setLeaving(true);
    try {
      await Promise.all(sessions.map((session) => leaveSession(session.id, session.ownerToken)));
    } catch {
      setToast({ message: "Não foi possível encerrar a sessão. Tente novamente.", type: "error" });
      setLeaving(false);
      return;
    }
    setSessions([]);
    setSelectedId(null);
    setConfirmLeave(false);
    setLeaving(false);
  };

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

  // Manual login from the home screen: same entry for oneway and twoway.
  // Twoway only resolves the room here, so the code stays valid for the name step.
  const handleJoinWithCode = async (sessionId: string, code: string) => {
    try {
      const data = await joinWithCode(sessionId, code);
      if (data.mode === "twoway") {
        setJoining(false);
        setPendingTwowayJoin({ id: data.sessionId, code });
        return null;
      }
      if (!data.phoneCredential) {
        return "ID ou código inválido ou expirado";
      }
      writeGuestSession(data.sessionId, data.phoneCredential);
      window.location.assign(`/entrar/${data.sessionId}`);
      return null;
    } catch (err) {
      if (err instanceof JoinError && err.status === 429) {
        return "Muitas tentativas, aguarde um pouco";
      }
      if (err instanceof JoinError && err.status === 410) {
        return "Sessão encerrada";
      }
      return "ID ou código inválido ou expirado";
    }
  };

  const handleJoinTwoway = async (name: string): Promise<string | null> => {
    if (!pendingTwowayJoin) return "Sessão inválida";
    try {
      const data = await joinTwowaySession(pendingTwowayJoin.id, {
        name,
        device: detectDevice(),
        code: pendingTwowayJoin.code,
      });
      writeGuestSession(data.sessionId, data.credential);
      writeTwowaySession(data.sessionId, data.participant);
      window.location.assign(`/entrar/${data.sessionId}?mode=twoway`);
      return null;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) return "Muitas tentativas, aguarde um pouco";
        if (error.status === 410) return "Sessão encerrada";
        if (error.code === "SESSION_FULL") return "Sala cheia";
        if (error.code === "WRONG_MODE") return "Esta sessão não é uma sessão de troca";
        if (error.status === 400) return "Nome inválido";
        if (error.status === 401) return "ID ou código inválido ou expirado";
      }
      return "Não foi possível entrar na sala. Tente novamente.";
    }
  };

  if (pendingTwowayJoin) {
    return (
      <TwowayNamePage
        title="Entrar na sessão de troca"
        description="Escolha o nome que os outros participantes verão nesta sala."
        submitLabel="Entrar na sala"
        onSubmit={handleJoinTwoway}
        onCancel={() => setPendingTwowayJoin(null)}
      />
    );
  }

  if (namingTwoway) {
    return (
      <TwowayNamePage
        title="Criar sessão de troca"
        description="Escolha o nome que os outros participantes verão nesta sala."
        submitLabel="Criar sala"
        onSubmit={handleCreateTwoway}
        onCancel={() => setNamingTwoway(false)}
      />
    );
  }

  if (twowaySession) {
    return (
      <TwowayRoomPage
        role="host"
        sessionId={twowaySession.id}
        token={twowaySession.ownerToken}
        visualId={twowaySession.visualId ?? twowaySession.shortId}
        qrToken={twowaySession.qrToken}
        hostId={twowaySession.hostId}
        onExit={() => setTwowaySession(null)}
      />
    );
  }

  if (joining) {
    return <JoinSessionForm onSubmit={handleJoinWithCode} onCancel={() => setJoining(false)} />;
  }

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goHome}
            aria-label="Ir para a página inicial"
            title="Ir para a página inicial"
            className="flex items-center gap-2 min-w-0 rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <Monitor size={20} strokeWidth={1.5} className="text-[var(--color-accent)] shrink-0" />
            <span className="text-base font-semibold tracking-tight">does not send</span>
            <span className="text-[11px] text-[var(--color-text-muted)] tabular shrink-0">
              v{APP_VERSION}
            </span>
          </button>
          {!hasActiveSession && (
            <div className="flex flex-wrap justify-end gap-2">
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNamingTwoway(true)}
                disabled={creating}
              >
                <Users size={16} strokeWidth={1.75} />
                Sessão de troca
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {sessions.length === 0 ? (
          <div className="flex items-center justify-center mt-12">
            <EmptyState
              icon={Monitor}
              title="Nenhuma sessão ativa"
              description="Crie uma sessão e escaneie o QR Code no outro dispositivo para transferir arquivos."
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
                  <Button
                    variant="ghost"
                    onClick={() => setNamingTwoway(true)}
                    disabled={creating}
                  >
                    <Users size={16} strokeWidth={1.75} />
                    Sessão de troca
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
                <SessionPage
                  role="host"
                  sessionId={selectedSession.id}
                  token={selectedSession.ownerToken}
                />
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

      <LeaveSessionModal
        open={confirmLeave}
        role="host"
        busy={leaving}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => void leaveActiveSessions()}
      />

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
