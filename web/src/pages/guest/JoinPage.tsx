import { useState, useRef, useEffect } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import {
  ApiError,
  joinTwowaySession,
  joinWithCode,
  pairSession,
  JoinError,
  type ParticipantInfo,
} from "../../lib/api.ts";
import { detectDevice } from "../../lib/device.ts";
import {
  clearGuestSession,
  readGuestSession,
  writeGuestSession,
} from "../../lib/guestSessionStorage.ts";
import {
  clearTwowaySession,
  readTwowaySession,
  writeTwowaySession,
} from "../../lib/twowaySessionStorage.ts";
import { JoinSessionForm } from "./JoinSessionForm.tsx";
import { SessionPage } from "../SessionPage.tsx";
import { TwowayNamePage } from "../twoway/TwowayNamePage.tsx";
import { TwowayRoomPage } from "../twoway/TwowayRoomPage.tsx";

const SCAN_AGAIN_MESSAGE = "Escaneie o QR Code novamente.";
const JOIN_ERROR_MESSAGE = "ID ou código inválido ou expirado";

interface JoinPageProps {
  sessionId?: string;
  token?: string;
  qrToken?: string;
}

/** Session ids whose credential was entered by code, restored on open. */
const JOINED_KEY = "dns_joined_session";

function rememberJoinedSession(id: string): void {
  try {
    localStorage.setItem(JOINED_KEY, id);
  } catch {}
}

function readJoinedSession(): string | null {
  try {
    const id = localStorage.getItem(JOINED_KEY);
    return id && readGuestSession(id).credential ? id : null;
  } catch {
    return null;
  }
}

export default function JoinPage({
  sessionId: propSessionId,
  token: propToken,
  qrToken: propQrToken,
}: JoinPageProps) {
  // Extract from props or URL
  const pathParts = window.location.pathname.split("/");
  const urlSessionId = propSessionId || pathParts[2] || "";
  const searchParams = new URLSearchParams(window.location.search);
  const qrToken = propQrToken || searchParams.get("qrToken") || "";
  const legacyToken = propToken || searchParams.get("token") || "";

  // A session entered by code (no URL) resumes from the same stored credential
  const restoredJoinedId = !urlSessionId ? readJoinedSession() : null;
  const storedSessionId = urlSessionId || restoredJoinedId || "";

  const initialStored = readGuestSession(storedSessionId);
  const storedTwoway = readTwowaySession(storedSessionId);
  const twowayCode = searchParams.get("code") || "";
  const initialTwoway = searchParams.get("mode") === "twoway" || storedTwoway !== null;

  const [twowayMode, setTwowayMode] = useState(initialTwoway);
  const [credential, setCredential] = useState<string | null>(
    initialStored.credential || (!qrToken && legacyToken ? legacyToken : null)
  );
  const [visualId, setVisualId] = useState<string | null>(
    initialStored.visualId ?? storedTwoway?.visualId ?? null,
  );
  const [twowayParticipant, setTwowayParticipant] = useState<ParticipantInfo | null>(
    storedTwoway?.participant ?? null,
  );
  const [twowayHostId, setTwowayHostId] = useState<string | null>(
    storedTwoway?.hostId ?? null,
  );
  const [pendingTwowayJoin, setPendingTwowayJoin] = useState<{
    id: string;
    code: string;
  } | null>(null);
  const isTwoway =
    twowayMode || storedTwoway !== null || pendingTwowayJoin !== null || twowayParticipant !== null;
  const [isPairing, setIsPairing] = useState<boolean>(() => {
    return Boolean(urlSessionId && !initialStored.credential && qrToken && !initialTwoway);
  });
  const [sessionError, setSessionError] = useState<string | null>(() => {
    if (!urlSessionId) {
      return initialStored.credential || (initialTwoway && twowayCode)
        ? null
        : SCAN_AGAIN_MESSAGE;
    }
    if (
      !initialStored.credential &&
      !qrToken &&
      !legacyToken &&
      !(initialTwoway && twowayCode)
    ) {
      return SCAN_AGAIN_MESSAGE;
    }
    return null;
  });

  // Session entered by id + code instead of the QR; wins over the URL lookup
  const [joinedSessionId, setJoinedSessionId] = useState<string | null>(restoredJoinedId);
  const [joining, setJoining] = useState(false);
  const sessionId = joinedSessionId ?? urlSessionId;
  const pairingInProgressRef = useRef<boolean>(false);

  useEffect(() => {
    if (isTwoway) return;
    if (credential || sessionError || !urlSessionId || !qrToken || joinedSessionId) {
      return;
    }
    if (pairingInProgressRef.current) {
      return;
    }

    pairingInProgressRef.current = true;
    let isCancelled = false;

    async function doPair() {
      setIsPairing(true);
      try {
        const data = await pairSession(urlSessionId, qrToken);
        const cred = data.phoneCredential;
        const vId = data.visualId || data.shortId || null;

        if (urlSessionId) {
          writeGuestSession(urlSessionId, cred, vId);
        }

        if (isCancelled) return;
        setCredential(cred);
        setVisualId(vId);
        setIsPairing(false);

        if (typeof window !== "undefined" && window.history && window.history.replaceState) {
          try {
            window.history.replaceState({}, "", window.location.pathname);
          } catch {}
        }
      } catch (err: any) {
        pairingInProgressRef.current = false;
        if (isCancelled) return;
        setIsPairing(false);
        const status = err?.status;
        const code = err?.code;

        if (status === 410 || code === "CLOSED") {
          setSessionError("Sessão encerrada pelo host.");
        } else if (status === 401 || status === 404 || code === "INVALID" || code === "NOT_FOUND") {
          setSessionError(SCAN_AGAIN_MESSAGE);
        } else if (status >= 500 && status < 600) {
          setSessionError("Servidor temporariamente indisponível.");
        } else if (!status || err?.name === "TypeError" || err?.message?.includes("fetch")) {
          setSessionError("Sem conexão com o servidor.");
        } else {
          setSessionError(err?.message || "Erro ao conectar à sessão.");
        }
      }
    }

    doPair();

    return () => {
      isCancelled = true;
      pairingInProgressRef.current = false;
    };
  }, [urlSessionId, qrToken, credential, sessionError, joinedSessionId, isTwoway]);

  const leaveSession = () => {
    if (sessionId) {
      clearGuestSession(sessionId);
      clearTwowaySession(sessionId);
    }
    if (joinedSessionId) {
      try {
        localStorage.removeItem(JOINED_KEY);
      } catch {}
      setJoinedSessionId(null);
    }
    setCredential(null);
    setVisualId(null);
    setTwowayParticipant(null);
    setTwowayHostId(null);
    // Always back to the entry screen, never to the dead session URL
    if (window.location.pathname !== "/") {
      try {
        window.history.replaceState({}, "", "/");
      } catch {}
    }
    setSessionError(SCAN_AGAIN_MESSAGE);
  };

  // The session became closed while connected: drop its stored credential.
  const handleSessionClosed = () => {
    if (!sessionId) return;
    clearGuestSession(sessionId);
    clearTwowaySession(sessionId);
    try {
      if (localStorage.getItem(JOINED_KEY) === sessionId) localStorage.removeItem(JOINED_KEY);
    } catch {}
  };

  const exitTwowayRoom = () => {
    if (sessionId) {
      clearGuestSession(sessionId);
      clearTwowaySession(sessionId);
    }
    window.location.assign("/");
  };

  const joinTwowayRoom = async (name: string): Promise<string | null> => {
    if (!urlSessionId) return "Sessão inválida";
    try {
      const data = await joinTwowaySession(urlSessionId, {
        name,
        device: detectDevice(),
        qrToken: qrToken || undefined,
        code: twowayCode || undefined,
      });
      writeGuestSession(data.sessionId, data.credential);
      writeTwowaySession(data.sessionId, data.participant);
      setCredential(data.credential);
      setTwowayParticipant(data.participant);
      setSessionError(null);
      if (window.history?.replaceState) {
        try {
          window.history.replaceState({}, "", window.location.pathname);
        } catch {}
      }
      return null;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) return "Muitas tentativas, aguarde um pouco";
        if (error.status === 410) return "Sessão encerrada";
        if (error.code === "SESSION_FULL") return "Sala cheia";
        if (error.code === "WRONG_MODE") return "Esta sessão não é uma sessão de troca";
        if (error.status === 400) return "Nome inválido";
        if (error.status === 401) return "QR Code inválido ou expirado";
      }
      return "Não foi possível entrar na sala. Tente novamente.";
    }
  };

  // Manual entry shared by oneway and twoway: twoway resolves the room first
  // and asks for a name; its code stays valid for the next request.
  const joinWithManualCode = async (rawId: string, rawCode: string) => {
    try {
      const data = await joinWithCode(rawId, rawCode);
      if (data.mode === "twoway") {
        setJoining(false);
        setTwowayMode(true);
        setPendingTwowayJoin({ id: data.sessionId, code: rawCode });
        return null;
      }
      if (!data.phoneCredential) return JOIN_ERROR_MESSAGE;
      // The canonical id: routes and WS never normalize, only the join lookup does
      const id = data.sessionId;
      try {
        writeGuestSession(id, data.phoneCredential);
        rememberJoinedSession(id);
      } catch {}
      setCredential(data.phoneCredential);
      setSessionError(null);
      setJoinedSessionId(id);
      return null;
    } catch (err) {
      if (err instanceof JoinError && err.status === 429) {
        return "Muitas tentativas, aguarde um pouco";
      }
      if (err instanceof JoinError && err.status === 410) {
        return "Sessão encerrada";
      }
      return JOIN_ERROR_MESSAGE;
    }
  };

  const joinTwowayByName = async (name: string): Promise<string | null> => {
    if (!pendingTwowayJoin) return "Sessão inválida";
    try {
      const data = await joinTwowaySession(pendingTwowayJoin.id, {
        name,
        device: detectDevice(),
        code: pendingTwowayJoin.code,
      });
      writeGuestSession(data.sessionId, data.credential);
      writeTwowaySession(data.sessionId, data.participant);
      setCredential(data.credential);
      setTwowayParticipant(data.participant);
      setJoinedSessionId(data.sessionId);
      setPendingTwowayJoin(null);
      setSessionError(null);
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

  if (pendingTwowayJoin && (!credential || !twowayParticipant)) {
    return (
      <TwowayNamePage
        title="Entrar na sessão de troca"
        description="Escolha o nome que os outros participantes verão nesta sala."
        submitLabel="Entrar na sala"
        onSubmit={joinTwowayByName}
        onCancel={() => {
          setPendingTwowayJoin(null);
          setTwowayMode(false);
        }}
      />
    );
  }

  if (sessionError) {
    if (joining) {
      return <JoinSessionForm onSubmit={joinWithManualCode} onCancel={() => setJoining(false)} />;
    }
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-[var(--color-error)] flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
              Sessão Indisponível
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {sessionError}
            </p>
          </div>
          <Button variant="ghost" size="md" onClick={() => setJoining(true)}>
            <KeyRound size={16} strokeWidth={1.75} />
            Entrar com código
          </Button>
        </Card>
      </div>
    );
  }

  if (isTwoway) {
    if (!credential || !twowayParticipant) {
      return (
        <TwowayNamePage
          title="Entrar na sessão de troca"
          description="Escolha o nome que os outros participantes verão nesta sala."
          submitLabel="Entrar na sala"
          onSubmit={joinTwowayRoom}
          onCancel={exitTwowayRoom}
        />
      );
    }
    return (
      <TwowayRoomPage
        role="guest"
        sessionId={sessionId}
        token={credential}
        visualId={visualId}
        hostId={twowayHostId}
        self={twowayParticipant}
        onExit={exitTwowayRoom}
        onSessionClosed={handleSessionClosed}
      />
    );
  }

  if (isPairing) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mx-auto" />
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Conectando ao host...
          </p>
        </Card>
      </div>
    );
  }

  // Connected always implies a credential; anything else is a bug, not a screen.
  if (!credential) return null;

  return (
    <SessionPage
      role="guest"
      sessionId={sessionId}
      token={credential}
      visualId={visualId}
      onLeave={leaveSession}
      onSessionClosed={handleSessionClosed}
    />
  );
}
