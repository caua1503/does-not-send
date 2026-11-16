import { useState } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";

const NAME_MAX_LENGTH = 40;

interface TwowayNamePageProps {
  title: string;
  description: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}

export function TwowayNamePage({
  title,
  description,
  submitLabel,
  initialName = "",
  onSubmit,
  onCancel,
}: TwowayNamePageProps) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= NAME_MAX_LENGTH && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const message = await onSubmit(trimmed);
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
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        </div>

        <div className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
          <Users size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          <p>{description}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Seu nome</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="nickname"
              autoFocus
              placeholder="Ex.: Ana"
              className="w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-50"
              disabled={submitting}
            />
            <span className="block text-right text-[11px] tabular text-[var(--color-text-muted)]">
              {name.length}/{NAME_MAX_LENGTH}
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-error)]">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="md" className="w-full" disabled={!canSubmit}>
            {submitting ? "Entrando..." : submitLabel}
          </Button>
        </form>
      </Card>
    </div>
  );
}
