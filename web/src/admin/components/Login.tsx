import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { AdminApiError } from "../../../../src/shared/admin/client.ts";
import { Button, Card } from "../../components/ui/index.ts";

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<void>;
  /** Shown when the session expires mid-use. */
  expired: boolean;
}

export function Login({ onLogin, expired }: LoginProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onLogin(username, password);
      setPassword("");
    } catch (err) {
      setError(loginMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-4">
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-light)]">
            <Lock size={20} className="text-[var(--color-accent)]" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Painel</h1>
            <p className="text-xs text-[var(--color-text-muted)]">does not send</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {expired && (
            <p role="status" className="text-sm text-[var(--color-warn)]">Sessão expirada. Entre de novo.</p>
          )}
          <div className="space-y-1">
            <label htmlFor="admin-user" className="text-sm font-medium">Usuário</label>
            <input
              id="admin-user"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="admin-password" className="text-sm font-medium">Senha</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function loginMessage(err: unknown): string {
  if (!(err instanceof AdminApiError)) return "Não foi possível entrar.";
  if (err.status === 401) return "Usuário ou senha inválidos.";
  if (err.status === 429) return err.message;
  if (err.code === "db_unavailable") return "Banco indisponível.";
  if (err.code === "timeout") return "Tempo esgotado. Tente de novo.";
  return "Não foi possível entrar.";
}
