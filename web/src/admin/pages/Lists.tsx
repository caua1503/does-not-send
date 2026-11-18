import type {
  AdminFilters,
  Paginated,
  SessionMetrics,
} from "../../../../src/shared/admin/types.ts";
import { SORT_KEYS } from "../../../../src/shared/admin/sorts.ts";
import type { AdminApi } from "../api.ts";
import { filterKey, readListSort, withPeriod } from "../filter-url.ts";
import { useRemote, type RemoteState } from "../use-remote.ts";
import { FiltersBar, type FilterChange } from "../components/Filters.tsx";
import { SessionsTable, TransfersTable, type SortState } from "../components/Lists.tsx";
import { EmptyStateCard, ErrorState, Skeleton } from "../components/States.tsx";
import { MetricCard } from "../components/MetricCard.tsx";
import { formatDecimal, formatDuration, formatNumber } from "../../../../src/shared/admin/format.ts";
import { Card } from "../../components/ui/index.ts";

interface FiltersPageProps extends FilterChange {
  api: AdminApi;
  filters: AdminFilters;
  params: URLSearchParams;
  tz: string;
  anchor: string;
  onFocusChange: (focused: boolean) => void;
  /** Bumps on manual/auto refresh. */
  refreshKey: number;
  /** Changes whenever any filter changes. */
  queryKey: string;
}

interface PageProps extends FiltersPageProps {
  onParams: (params: URLSearchParams) => void;
}

export function TransfersPage(props: PageProps) {
  const { api, filters, params, tz } = props;
  const query = withPeriod(filters, props.anchor);
  const { sort, dir } = readListSort(params, SORT_KEYS.transfers, "startedAt");
  const state = useRemote(
    (signal) => api.transfers({ filters: query, sort, dir }, signal),
    [filterKey(query), query.page, query.pageSize, sort, dir, props.refreshKey],
  );
  const sortState = sortStateFor(sort, dir, props.onParams, params);

  return (
    <section aria-labelledby="transfers-title" className="space-y-4">
      <h2 id="transfers-title" className="text-xl font-semibold tracking-tight">Transferências</h2>
      <FiltersBar
        {...filtersBarProps(props, filters)}
        showGranularity={false}
        granularity={filters.granularity}
        onGranularity={() => {}}
      />
      <Content state={state} noun="transferências">
        {state.data && (
          <Card className="overflow-hidden p-3">
            <TransfersTable
              page={state.data}
              sort={sortState}
              tz={tz}
              onPage={(page) => pageTo(props.onParams, params, page)}
            />
          </Card>
        )}
      </Content>
    </section>
  );
}

export function SessionsPage(props: PageProps) {
  const { api, filters, params, tz } = props;
  const query = withPeriod(filters, props.anchor);
  const { sort, dir } = readListSort(params, SORT_KEYS.sessions, "createdAt");
  const state = useRemote(
    (signal) => api.sessions({ filters: query, sort, dir }, signal),
    [filterKey(query), query.page, query.pageSize, sort, dir, props.refreshKey],
  );
  const metrics = useRemote(
    (signal) => api.sessionMetrics(query, signal),
    [filterKey(query), props.refreshKey],
  );
  const sortState = sortStateFor(sort, dir, props.onParams, params);

  return (
    <section aria-labelledby="sessions-title" className="space-y-4">
      <h2 id="sessions-title" className="text-xl font-semibold tracking-tight">Sessões</h2>
      <FiltersBar
        {...filtersBarProps(props, filters)}
        showGranularity={false}
        granularity={filters.granularity}
        onGranularity={() => {}}
      />
      {metrics.status === "error" && !metrics.data && (
        <ErrorState error={metrics.error} onRetry={metrics.reload} />
      )}
      {metrics.data && <SessionMetricsCards metrics={metrics.data} />}
      <Content state={state} noun="transferências">
        {state.data && (
          <Card className="overflow-hidden p-3">
            <SessionsTable
              page={state.data}
              sort={sortState}
              tz={tz}
              onPage={(page) => pageTo(props.onParams, params, page)}
            />
          </Card>
        )}
      </Content>
    </section>
  );
}

function abandonmentHint(stats: { total: number; abandoned: number }): string {
  if (stats.total === 0) return "sem sessões no período";
  return `${formatNumber(stats.abandoned)} sem ninguém (${Math.round((stats.abandoned / stats.total) * 100)}%)`;
}

function SessionMetricsCards({ metrics }: { metrics: SessionMetrics }) {
  const { byMode, twowayParticipants } = metrics;
  const unknown = byMode.unknown.total;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard
        label="Sessões comuns"
        value={formatNumber(byMode.oneway.total)}
        hint={`${abandonmentHint(byMode.oneway)}${unknown > 0 ? ` · ${formatNumber(unknown)} sem tipo registrado` : ""}`}
      />
      <MetricCard
        label="Sessões de troca"
        value={formatNumber(byMode.twoway.total)}
        hint={abandonmentHint(byMode.twoway)}
      />
      <MetricCard
        label="Pessoas em troca"
        value={formatNumber(twowayParticipants.total)}
        hint={`média ${formatDecimal(twowayParticipants.average)} · máx ${formatNumber(twowayParticipants.max)} por sessão`}
      />
      <MetricCard
        label="Duração média"
        value={
          metrics.averageDurationSeconds === null
            ? "—"
            : formatDuration(metrics.averageDurationSeconds)
        }
        hint="sessões encerradas"
      />
      <MetricCard
        label="Transferências/sessão"
        value={formatDecimal(metrics.averageTransfersPerSession)}
        hint="concluídas, no período"
      />
    </div>
  );
}

function Content<T>({
  state,
  noun,
  children,
}: {
  state: RemoteState<Paginated<T>> & { reload: () => void };
  noun: string;
  children: React.ReactNode;
}) {
  if (state.status === "error") return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.status === "loading") return <Skeleton rows={6} label="Carregando lista" />;
  if (state.data.total === 0) {
    return <EmptyStateCard description={`Nenhuma de ${noun} nos filtros atuais.`} />;
  }
  return <>{children}</>;
}

function filtersBarProps(props: FiltersPageProps, filters: AdminFilters) {
  return {
    filters,
    select: props.select,
    text: props.text,
    reset: props.reset,
    onFocusChange: props.onFocusChange,
  };
}

function pageTo(
  onParams: (params: URLSearchParams) => void,
  params: URLSearchParams,
  page: number,
): void {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  onParams(next);
}

function sortStateFor(
  sort: string,
  dir: "asc" | "desc",
  onParams: (params: URLSearchParams) => void,
  params: URLSearchParams,
): SortState {
  return {
    sort,
    dir,
    onChange: (column) => {
      const next = new URLSearchParams(params);
      next.set("page", "1");
      if (column === sort) {
        next.set("sort", column);
        next.set("dir", dir === "asc" ? "desc" : "asc");
      } else {
        next.set("sort", column);
        next.set("dir", "desc");
      }
      onParams(next);
    },
  };
}
