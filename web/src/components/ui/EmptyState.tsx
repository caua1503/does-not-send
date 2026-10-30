import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

interface EmptyStateProps {
  icon: ComponentType<LucideProps>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-light)] flex items-center justify-center">
        <Icon
          size={32}
          strokeWidth={1.5}
          className="text-[var(--color-accent)]"
        />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold tracking-tight text-[var(--color-text)]">{title}</p>
        <p className="text-sm text-[var(--color-text-muted)] max-w-xs">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
