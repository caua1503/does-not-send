import { Check } from "lucide-react";
import { formatCodeGroups } from "../lib/loginCode.ts";

interface ManualLoginCodeProps {
  code: string | null;
  seconds: number;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  copied: boolean;
  onCopy: () => void;
  className?: string;
}

/** On-demand numeric code, for devices that cannot read the QR. */
export function ManualLoginCode({
  code,
  seconds,
  generating,
  error,
  onGenerate,
  copied,
  onCopy,
  className,
}: ManualLoginCodeProps) {
  return (
    <div
      data-testid="manual-login-code"
      className={["flex flex-col items-center gap-0.5 text-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      {code ? (
        <>
          <span className="text-[10px] text-[var(--color-text-muted)]">Código</span>
          <button
            type="button"
            data-testid="manual-login-code-value"
            onClick={(event) => {
              event.stopPropagation();
              onCopy();
            }}
            title="Clique para copiar o código"
            className="font-mono font-bold text-sm tracking-widest tabular text-[var(--color-accent)] cursor-pointer hover:underline"
          >
            {formatCodeGroups(code)}
            {copied && (
              <Check size={12} strokeWidth={2.5} className="ml-1 inline align-[-2px]" />
            )}
          </button>
          <span className="text-[10px] tabular text-[var(--color-text-muted)]">
            troca em {seconds}s
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:ring-2 hover:ring-[var(--color-accent)] transition-all disabled:opacity-50"
        >
          {generating ? "Gerando…" : "Gerar código"}
        </button>
      )}
      {error && (
        <span className="text-[10px] text-[var(--color-error)]">{error}</span>
      )}
    </div>
  );
}
