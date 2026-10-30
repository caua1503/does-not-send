type BadgeVariant = "neutral" | "success" | "warn" | "error";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--color-border)] text-[var(--color-text-muted)]",
  success: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  error: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

export function Badge({ label, variant = "neutral" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        variantClasses[variant],
      ].join(" ")}
    >
      {label}
    </span>
  );
}
