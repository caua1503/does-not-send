import { AlertTriangle, Ban, Database, Inbox } from "lucide-react";
import { AdminApiError } from "../../../../src/shared/admin/client.ts";
import { POSITION_LABELS } from "../../../../src/shared/admin/labels.ts";
import { Button, Card, EmptyState } from "../../components/ui/index.ts";

export function Skeleton({ rows = 5, label = "Carregando" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-[var(--radius-btn)] bg-[var(--color-border)]/60"
        />
      ))}
    </div>
  );
}

export function MetricsSkeleton() {
  return (
    <div role="status" aria-label="Carregando indicadores" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} className="h-24 animate-pulse p-4">{null}</Card>
      ))}
    </div>
  );
}

/** 503 db_unavailable gets its own wording; everything else offers a retry. */
export function ErrorState({ error, onRetry }: { error: AdminApiError; onRetry: () => void }) {
  if (error.code === "db_unavailable") {
    return (
      <Card>
        <EmptyState
          icon={Database}
          title={POSITION_LABELS.dbUnavailable}
          description="O banco de dados não respondeu. A transferência de arquivos continua funcionando; o painel volta assim que o banco voltar."
          action={<Button variant="ghost" onClick={onRetry}>{POSITION_LABELS.retry}</Button>}
        />
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState
        icon={AlertTriangle}
        title={POSITION_LABELS.loadFailed}
        description={error.status === 0 && error.code === "timeout" ? "A consulta demorou demais." : "Ocorreu um erro ao consultar o painel."}
        action={<Button variant="ghost" onClick={onRetry}>{POSITION_LABELS.retry}</Button>}
      />
    </Card>
  );
}

export function EmptyStateCard({ description }: { description: string }) {
  return (
    <Card>
      <EmptyState icon={Inbox} title={POSITION_LABELS.noData} description={description} />
    </Card>
  );
}

export function ForbiddenState() {
  return (
    <Card>
      <EmptyState icon={Ban} title="Acesso negado" description="Faça login para ver o painel." />
    </Card>
  );
}
