import { Card } from "../../components/ui/index.ts";

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </Card>
  );
}
