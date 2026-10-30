interface StatusDotProps {
  connected: boolean;
}

export function StatusDot({ connected }: StatusDotProps) {
  return (
    <span
      aria-label={connected ? "conectado" : "desconectado"}
      title={connected ? "Conectado" : "Desconectado"}
      className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]"
    >
      <span
        className={[
          "w-2 h-2 rounded-full flex-shrink-0",
          connected
            ? "bg-[var(--color-success)] animate-pulse"
            : "bg-[var(--color-text-muted)]",
        ].join(" ")}
      />
      <span className="sr-only">{connected ? "Conectado" : "Desconectado"}</span>
    </span>
  );
}
