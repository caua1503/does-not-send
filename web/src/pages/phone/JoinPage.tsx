import { useState, useRef, useEffect } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { pairSession, joinWithCode, JoinError } from "../../lib/api.ts";
import { JoinSessionForm } from "./JoinSessionForm.tsx";
import { SessionPage } from "../SessionPage.tsx";

const SCAN_AGAIN_MESSAGE = "Escaneie o QR Code novamente.";
const JOIN_ERROR_MESSAGE = "ID ou código inválido ou expirado";

interface JoinPageProps {
  sessionId?: string;
  token?: string;
  qrToken?: string;
}

interface StoredSession {
  phoneCredential?: string;
  visualId?: string;
}

function readStoredSession(id: string): { phoneCredential: string | null; visualId: string | null } {
  if (!id) return { phoneCredential: null, visualId: null };
  try {
    const raw = localStorage.getItem(`dns_phone_cred_${id}`);
    if (!raw) return { phoneCredential: null, visualId: null };
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed && typeof parsed === "object") {
        return {
          phoneCredential: parsed.phoneCredential || null,
          visualId: parsed.visualId || null,
        };
      }
      return { phoneCredential: raw, visualId: null };
    } catch {
      return { phoneCredential: raw, visualId: null };
    }
  } catch {
    return { phoneCredential: null, visualId: null };
  }
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
    return id && readStoredSession(id).phoneCredential ? id : null;
  } catch {
    return null;
  }
}

function clearStoredSession(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(`dns_phone_cred_${id}`);
  } catch {}
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

  const storageKey = storedSessionId ? `dns_phone_cred_${storedSessionId}` : "";
  const initialStored = readStoredSession(storedSessionId);

  const [credential, setCredential] = useState<string | null>(
    initialStored.phoneCredential || (!qrToken && legacyToken ? legacyToken : null)
  );
  const [visualId, setVisualId] = useState<string | null>(initialStored.visualId);
  const [isPairing, setIsPairing] = useState<boolean>(() => {
    return Boolean(urlSessionId && !initialStored.phoneCredential && qrToken);
  });
  const [sessionError, setSessionError] = useState<string | null>(() => {
    if (!urlSessionId) {
      return initialStored.phoneCredential ? null : SCAN_AGAIN_MESSAGE;
    }
    if (!initialStored.phoneCredential && !qrToken && !legacyToken) {
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

        if (storageKey) {
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ phoneCredential: cred, visualId: vId })
            );
          } catch {
            // Ignore localStorage quota error
          }
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
          setSessionError("Sessão encerrada pelo computador.");
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
  }, [urlSessionId, qrToken, credential, sessionError, storageKey, joinedSessionId]);

  const leaveSession = () => {
    if (sessionId) clearStoredSession(sessionId);
    if (joinedSessionId) {
      try {
        localStorage.removeItem(JOINED_KEY);
      } catch {}
      setJoinedSessionId(null);
    }
    setCredential(null);
    setVisualId(null);
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
    clearStoredSession(sessionId);
    try {
      if (localStorage.getItem(JOINED_KEY) === sessionId) localStorage.removeItem(JOINED_KEY);
    } catch {}
  };

  // Manual login: same credential the QR pairs give, so the flow below is unchanged.
  const joinWithManualCode = async (rawId: string, rawCode: string) => {
    try {
      const data = await joinWithCode(rawId, rawCode);
      // The canonical id: routes and WS never normalize, only the join lookup does
      const id = data.sessionId;
      try {
        localStorage.setItem(
          `dns_phone_cred_${id}`,
          JSON.stringify({ phoneCredential: data.phoneCredential }),
        );
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
      return JOIN_ERROR_MESSAGE;
    }
  };

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

  if (isPairing) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mx-auto" />
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Conectando ao computador...
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
