import { useEffect, useRef, useState } from "react";
import { AlertCircle, KeyRound } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ApiError, getInvite, redeemInvite, type InviteState } from "../../lib/api.ts";
import { readGuestSession, writeGuestSession } from "../../lib/guestSessionStorage.ts";

const DEVICE_ID_KEY = "dns_device_id";

type InviteError =
  | Exclude<InviteState, "valid">
  | "not_found"
  | "closed"
  | "rate_limited"
  | "server"
  | "network"
  | "generic";

const ERROR_MESSAGES: Record<InviteError, string> = {
  expired: "Este convite expirou.",
  used: "Este convite já foi usado.",
  revoked: "Este convite foi revogado.",
  not_found: "Convite não encontrado.",
  closed: "A sessão foi encerrada.",
  rate_limited: "Muitas tentativas. Aguarde um pouco e tente novamente.",
  server: "Servidor temporariamente indisponível.",
  network: "Sem conexão com o servidor.",
  generic: "Não foi possível entrar na sessão.",
};

function codeFromPath(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "i") return "";
  try {
    return decodeURIComponent(parts[1] ?? "");
  } catch {
    return "";
  }
}

/** Stable per-browser id so a single invite can be retried by the same device. */
function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const id = newDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return newDeviceId();
  }
}

function newDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorFromApi(error: ApiError): InviteError {
  if (error.code === "EXPIRED") return "expired";
  if (error.code === "USED") return "used";
  if (error.code === "REVOKED") return "revoked";
  if (error.code === "CLOSED") return "closed";
  if (error.code === "NOT_FOUND" || error.status === 404) return "not_found";
  if (error.status === 429) return "rate_limited";
  if (error.status >= 500) return "server";
  return "generic";
}

function enterSession(sessionId: string): void {
  window.location.assign(`/entrar/${encodeURIComponent(sessionId)}`);
}

export default function InvitePage() {
  const [error, setError] = useState<InviteError | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function enter() {
      const code = codeFromPath();
      if (!code) {
        setError("not_found");
        return;
      }

      try {
        const invite = await getInvite(code);
        if (!invite.sessionId) {
          setError("not_found");
          return;
        }

        const stored = readGuestSession(invite.sessionId);
        if (stored.credential) {
          enterSession(invite.sessionId);
          return;
        }

        // Twoway joins need a name, so the invite code rides along to the
        // session page and is consumed there by the participants route.
        if (invite.mode === "twoway") {
          if (invite.state !== "valid") {
            setError(invite.state);
            return;
          }
          const params = new URLSearchParams({ mode: "twoway", code });
          window.location.assign(
            `/entrar/${encodeURIComponent(invite.sessionId)}?${params.toString()}`,
          );
          return;
        }

        if (invite.state !== "valid") {
          setError(invite.state);
          return;
        }

        const data = await redeemInvite(code, deviceId());
        if (!data.phoneCredential) {
          setError("generic");
          return;
        }

        writeGuestSession(
          invite.sessionId,
          data.phoneCredential,
          data.visualId || data.shortId || null,
        );
        enterSession(invite.sessionId);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(errorFromApi(err));
        } else {
          setError("network");
        }
      }
    }

    void enter();
  }, []);

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-[var(--color-error)] flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
              Convite indisponível
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{ERROR_MESSAGES[error]}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => window.location.assign("/?entrar=1")}
            >
              <KeyRound size={16} strokeWidth={1.75} />
              Entrar com código
            </Button>
            <Button variant="ghost" size="md" onClick={() => window.location.assign("/")}>
              Voltar ao início
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full mx-auto" />
        <p role="status" className="text-sm font-medium text-[var(--color-text-muted)]">
          Entrando na sessão...
        </p>
      </Card>
    </div>
  );
}
