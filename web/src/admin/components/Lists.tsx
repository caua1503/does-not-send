import { Link } from "./Link.tsx";
import type { Paginated, SessionRow, TransferRow } from "../../../../src/shared/admin/types.ts";
import {
  CLOSE_REASON_LABELS,
  POSITION_LABELS,
  TRANSFER_STATUS_LABELS,
  categoryLabel,
} from "../../../../src/shared/admin/labels.ts";
import { formatBytes, formatDateTime } from "../../../../src/shared/admin/format.ts";
import { Badge, Card } from "../../components/ui/index.ts";

type BadgeVariant = "neutral" | "success" | "warn" | "error";

function statusVariant(status: TransferRow["status"]): BadgeVariant {
  return status === "completed" ? "success" : status === "failed" ? "error" : "warn";
}

export interface SortState {
  sort: string;
  dir: "asc" | "desc";
  onChange: (sort: string) => void;
}

function SortHeader({
  label,
  column,
  state,
  className = "",
}: {
  label: string;
  column: string;
  state: SortState;
  className?: string;
}) {
  const active = state.sort === column;
  return (
    <th scope="col" className={`px-3 py-2 text-left font-medium ${className}`}>
      <button
        type="button"
        onClick={() => state.onChange(column)}
        data-active={active ? state.dir : undefined}
        className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
      >
        {label}
        <span aria-hidden className="text-[10px]">{active ? (state.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

interface ListProps<T> {
  page: Paginated<T>;
  sort: SortState;
  onPage: (page: number) => void;
  tz?: string;
}

export function TransfersTable({ page, sort, onPage, tz }: ListProps<TransferRow>) {
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          <tr>
            <SortHeader label="Arquivo" column="name" state={sort} />
            <SortHeader label="Tamanho" column="size" state={sort} className="text-right" />
            <SortHeader label="Situação" column="status" state={sort} />
            <SortHeader label="Categoria" column="category" state={sort} />
            <SortHeader label="Início" column="startedAt" state={sort} />
            <SortHeader label="Fim" column="finishedAt" state={sort} />
          </tr>
        </thead>
        <tbody>
          {page.items.map((t) => (
            <tr key={t.id} className="border-b border-[var(--color-border)]/60 last:border-0 hover:bg-[var(--color-accent-light)]/40">
              <td className="max-w-[22rem] px-3 py-2">
                <Link to={`#/transfers/${encodeURIComponent(t.id)}`} className="block truncate font-medium">
                  {t.name}
                </Link>
                <span className="text-xs text-[var(--color-text-muted)]">sessão {t.sessionVisualId}</span>
              </td>
              <td className="px-3 py-2 text-right tabular">{formatBytes(t.size)}</td>
              <td className="px-3 py-2">
                <Badge label={TRANSFER_STATUS_LABELS[t.status]} variant={statusVariant(t.status)} />
              </td>
              <td className="px-3 py-2">{categoryLabel(t.category)}</td>
              <td className="px-3 py-2 tabular">{formatDateTime(t.startedAt, tz)}</td>
              <td className="px-3 py-2 tabular">{t.finishedAt ? formatDateTime(t.finishedAt, tz) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 md:hidden">
        {page.items.map((t) => (
          <li key={t.id}>
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <Link to={`#/transfers/${encodeURIComponent(t.id)}`} className="min-w-0 break-words font-medium">
                  {t.name}
                </Link>
                <Badge label={TRANSFER_STATUS_LABELS[t.status]} variant={statusVariant(t.status)} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                <dt>Tamanho</dt>
                <dd className="text-right text-[var(--color-text)] tabular">{formatBytes(t.size)}</dd>
                <dt>Categoria</dt>
                <dd className="text-right text-[var(--color-text)]">{categoryLabel(t.category)}</dd>
                <dt>Início</dt>
                <dd className="text-right text-[var(--color-text)] tabular">{formatDateTime(t.startedAt, tz)}</dd>
                <dt>Sessão</dt>
                <dd className="text-right text-[var(--color-text)]">{t.sessionVisualId}</dd>
              </dl>
            </Card>
          </li>
        ))}
      </ul>
      <Pager page={page} onPage={onPage} noun="transferências" />
    </>
  );
}

export function SessionsTable({ page, sort, onPage, tz }: ListProps<SessionRow>) {
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">Sessão</th>
            <SortHeader label="Criada em" column="createdAt" state={sort} />
            <SortHeader label="Pareada em" column="pairedAt" state={sort} />
            <th scope="col" className="px-3 py-2 text-left font-medium">Situação</th>
            <SortHeader label="Arquivos" column="fileCount" state={sort} className="text-right" />
            <SortHeader label="Volume" column="totalBytes" state={sort} className="text-right" />
          </tr>
        </thead>
        <tbody>
          {page.items.map((s) => (
            <tr key={s.id} className="border-b border-[var(--color-border)]/60 last:border-0 hover:bg-[var(--color-accent-light)]/40">
              <td className="px-3 py-2">
                <Link to={`#/sessions/${encodeURIComponent(s.id)}`} className="font-medium">{s.visualId}</Link>
              </td>
              <td className="px-3 py-2 tabular">{formatDateTime(s.createdAt, tz)}</td>
              <td className="px-3 py-2 tabular">{s.pairedAt ? formatDateTime(s.pairedAt, tz) : "—"}</td>
              <td className="px-3 py-2"><SessionStatus session={s} /></td>
              <td className="px-3 py-2 text-right tabular">{s.fileCount}</td>
              <td className="px-3 py-2 text-right tabular">{formatBytes(s.totalBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 md:hidden">
        {page.items.map((s) => (
          <li key={s.id}>
            <Card className="p-3">
              <div className="flex items-start justify-between gap-2">
                <Link to={`#/sessions/${encodeURIComponent(s.id)}`} className="font-medium">{s.visualId}</Link>
                <SessionStatus session={s} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                <dt>Criada em</dt>
                <dd className="text-right text-[var(--color-text)] tabular">{formatDateTime(s.createdAt, tz)}</dd>
                <dt>Arquivos</dt>
                <dd className="text-right text-[var(--color-text)] tabular">{s.fileCount}</dd>
                <dt>Volume</dt>
                <dd className="text-right text-[var(--color-text)] tabular">{formatBytes(s.totalBytes)}</dd>
              </dl>
            </Card>
          </li>
        ))}
      </ul>
      <Pager page={page} onPage={onPage} noun="sessões" />
    </>
  );
}

export function SessionStatus({ session }: { session: SessionRow }) {
  if (session.isActive) {
    return <Badge label={POSITION_LABELS.sessionActive} variant="warn" />;
  }
  return (
    <Badge
      label={session.closeReason ? CLOSE_REASON_LABELS[session.closeReason] : POSITION_LABELS.sessionClosed}
      variant="neutral"
    />
  );
}

function Pager<T>({
  page,
  onPage,
  noun,
}: {
  page: Paginated<T>;
  onPage: (page: number) => void;
  noun: string;
}) {
  return (
    <nav aria-label={`Paginação de ${noun}`} className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3 text-sm">
      <p className="text-xs text-[var(--color-text-muted)] tabular">
        {page.total === 0
          ? `0 ${noun}`
          : `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.total)} de ${page.total} ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
          disabled={page.page <= 1}
          onClick={() => onPage(page.page - 1)}
        >
          Anterior
        </button>
        <span className="text-xs tabular">{page.page}/{Math.max(1, page.totalPages)}</span>
        <button
          type="button"
          className="rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
          disabled={page.page >= page.totalPages}
          onClick={() => onPage(page.page + 1)}
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
