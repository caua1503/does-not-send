interface ProgressBarProps {
  /** 0 to 1 */
  value: number;
  max?: number;
  className?: string;
  label?: string;
}

export function ProgressBar({ value, max = 1, className = "", label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value / (max || 1))) * 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "progresso"}
      className={["w-full h-[6px] bg-[var(--color-border)] rounded-full overflow-hidden", className].join(" ")}
    >
      <div
        className="h-full bg-[var(--color-accent)] rounded-full transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
