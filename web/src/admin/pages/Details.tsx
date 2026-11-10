import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import {
  formatBytes,
  formatDateTime,
  formatTime,
} from "../../../../src/shared/admin/format.ts";
import {
  CLOSE_REASON_LABELS,
  POSITION_LABELS,
  TRANSFER_STATUS_LABELS,
  categoryLabel,
} from "../../../../src/shared/admin/labels.ts";
import type { SessionRow, SessionTimelineItem } from "../../../../src/shared/admin/types.ts";
import type { AdminApi } from "../api.ts";
import { useRemote } from "../use-remote.ts";
import { Link } from "../components/Link.tsx";
import { SessionStatus, statusVariant } from "../components/Lists.tsx";
import { ErrorState, Skeleton } from "../components/States.tsx";
import { Badge, Card, EmptyState } from "../../components/ui/index.ts";
import { FileQuestion } from "lucide-react";

export function SessionDetailPage({ api, id, tz }: { api: AdminApi; id: string; tz: string }) {
  const state = useRemote((signal) => api.sessionDetail(id, signal), [id]);
  return (
    <section className="space-y-4">
      <BackLink to="#/sessions" label="Sessões" />
      <h2 className="text-xl font-semibold tracking-tight">Sessão</h2>
      {state.status === "error" && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === "loading" && <Skeleton rows={6} label="Carregando sessão" />}
      {state.data && (
        <>
          <SessionFactCard session={state.data.session} tz={tz} />
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="text-sm font-semibold">Linha do tempo</h3>
              <ol className="mt-3 space-y-3 text-sm">
                {state.data.timeline.map((item, index) => (
                  <TimelineItem key={`${item.kind}-${index}`} item={item} tz={tz} />
                ))}
              </ol>
            </Card>
            <Card className="p-4">
              <h3 className="text-sm font-semibold">Transferências</h3>
              {state.data.transfers.length === 0 ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Nenhuma transferência.</p>
              ) : (
                <ul className="mt-2 divide-y divide-[var(--color-border)]/60 text-sm">
                  {state.data.transfers.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                      <Link to={`#/transfers/${encodeURIComponent(t.id)}`} className="min-w-0 truncate">
                        {t.name}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular text-[var(--color-text-muted)]">{formatBytes(t.size)}</span>
                        <Badge
                          label={TRANSFER_STATUS_LABELS[t.status]}
                          variant={statusVariant(t.status)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card className="p-4">
            <h3 className="text-sm font-semibold">Outras sessões com o mesmo IP (até 20)</h3>
            {state.data.relatedSessions.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Nenhuma outra sessão.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)]/60 text-sm">
                {state.data.relatedSessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link to={`#/sessions/${encodeURIComponent(s.id)}`} className="font-medium">{s.visualId}</Link>
                    <span className="tabular text-xs text-[var(--color-text-muted)]">{formatDateTime(s.createdAt, tz)}</span>
                    <SessionStatus session={s} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

export function TransferDetailPage({ api, id, tz }: { api: AdminApi; id: string; tz: string }) {
  const state = useRemote((signal) => api.transferDetail(id, signal), [id]);
  return (
    <section className="space-y-4">
      <BackLink to="#/transfers" label="Transferências" />
      <h2 className="text-xl font-semibold tracking-tight">Transferência</h2>
      {state.status === "error" &&
        (state.error.status === 404 ? (
          <Card>
            <EmptyState
              icon={FileQuestion}
              title="Transferência não encontrada"
              description="Ela pode ter sido removida junto com a sessão."
            />
          </Card>
        ) : (
          <ErrorState error={state.error} onRetry={state.reload} />
        ))}
      {state.status === "loading" && <Skeleton rows={5} label="Carregando transferência" />}
      {state.data && (
        <>
          <Card className="p-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Fact label="Arquivo">{state.data.transfer.name}</Fact>
              <Fact label="Tamanho">{formatBytes(state.data.transfer.size)}</Fact>
              <Fact label="Situação">
                <Badge
                  label={TRANSFER_STATUS_LABELS[state.data.transfer.status]}
                  variant={statusVariant(state.data.transfer.status)}
                />
              </Fact>
              <Fact label="Categoria">{categoryLabel(state.data.transfer.category)}</Fact>
              <Fact label="Extensão">{state.data.transfer.extension || "—"}</Fact>
              <Fact label="Início">{formatDateTime(state.data.transfer.startedAt, tz)}</Fact>
              <Fact label="Fim">
                {state.data.transfer.finishedAt ? formatDateTime(state.data.transfer.finishedAt, tz) : "—"}
              </Fact>
              <Fact label="Sessão">
                <Link to={`#/sessions/${encodeURIComponent(state.data.session.id)}`} className="underline">
                  {state.data.session.visualId}
                </Link>
              </Fact>
            </dl>
          </Card>
          <SessionFactCard session={state.data.session} tz={tz} />
        </>
      )}
    </section>
  );
}

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState icon={FileQuestion} title="Página não encontrada" description="Confira o endereço ou volte ao painel." />
    </Card>
  );
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
      <ArrowLeft size={14} aria-hidden /> {label}
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function SessionFactCard({ session, tz }: { session: SessionRow; tz: string }) {
  const ips = [session.computerIp, session.phoneIp].filter((ip): ip is string => Boolean(ip));
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Sessão {session.visualId}</h3>
        <SessionStatus session={session} />
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Criada em">{formatDateTime(session.createdAt, tz)}</Fact>
        <Fact label="Pareada em">{session.pairedAt ? formatDateTime(session.pairedAt, tz) : "—"}</Fact>
        <Fact label="Encerrada em">{session.closedAt ? formatDateTime(session.closedAt, tz) : "—"}</Fact>
        <Fact label="Motivo do encerramento">
          {session.closeReason ? CLOSE_REASON_LABELS[session.closeReason] : POSITION_LABELS.sessionActive}
        </Fact>
        <Fact label="Arquivos concluídos">{session.fileCount} ({formatBytes(session.totalBytes)})</Fact>
        <Fact label="IPs">{ips.length > 0 ? ips.join(" · ") : "—"}</Fact>
      </dl>
    </Card>
  );
}

function TimelineItem({ item, tz }: { item: SessionTimelineItem; tz: string }) {
  const text = useMemo(() => describe(item), [item]);
  const dot = item.kind === "closed" ? "bg-[var(--color-text-muted)]" : item.kind === "transfer_finished" && item.status === "failed" ? "bg-[var(--color-error)]" : "bg-[var(--color-accent)]";
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0">
        <p className="tabular text-xs text-[var(--color-text-muted)]">{formatTime(item.at, tz)}</p>
        <p className="break-words">{text}</p>
      </div>
    </li>
  );
}

function describe(item: SessionTimelineItem): string {
  switch (item.kind) {
    case "created":
      return "Sessão criada";
    case "paired":
      return "Celular pareado";
    case "transfer_started":
      return "Transferência iniciada";
    case "transfer_finished":
      return `Transferência ${TRANSFER_STATUS_LABELS[item.status].toLowerCase()} (${formatBytes(item.size)})`;
    case "closed":
      return `Sessão encerrada — ${CLOSE_REASON_LABELS[item.reason]}`;
  }
}

