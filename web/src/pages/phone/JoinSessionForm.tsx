import { useState } from "react";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { digitsOnly, normalizeSessionId } from "../../lib/loginCode.ts";

interface JoinSessionFormProps {
  /** Resolves to an error message, or null on success. */
  onSubmit: (sessionId: string, code: string) => Promise<string | null>;
  onCancel: () => void;
}

const inputClass =
  "w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] " +
  "px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] " +
  "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-50";

export function JoinSessionForm({ onSubmit, onCancel }: JoinSessionFormProps) {
  const [sessionId, setSessionId] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = normalizeSessionId(sessionId).length >= 6 && code.length === 6 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const message = await onSubmit(sessionId, code);
    if (message) {
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[var(--color-bg)]">
      <Card className="max-w-md w-full p-6 space-y-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-accent-light)] transition-colors"
            aria-label="Voltar"
          >
            <ArrowLeft size={16} strokeWidth={1.75} />
          </button>
          <h1 className="text-base font-semibold tracking-tight">Entrar com código</h1>
        </div>

        <div className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
          <KeyRound size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          <p>Use o ID da sessão e o código de 6 dígitos mostrados no computador.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">ID da sessão</span>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="P79XFJ"
              className={`${inputClass} font-mono`}
              disabled={submitting}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Código</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(digitsOnly(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000 000"
              className={`${inputClass} font-mono tracking-[0.3em] tabular text-center text-lg`}
              disabled={submitting}
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-error)]">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="md" className="w-full" disabled={!canSubmit}>
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
