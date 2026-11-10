import { useCallback } from "react";
import {
  formatBucketLabel,
  formatBytes,
  formatDate,
  formatNumber,
} from "../../../../src/shared/admin/format.ts";
import {
  CATEGORY_LABELS,
  GRANULARITY_LABELS,
  TRANSFER_STATUS_LABELS,
} from "../../../../src/shared/admin/labels.ts";
import type { TransferStatus } from "../../../../src/shared/admin/types.ts";
import type { AdminFilters, Granularity } from "../../../../src/shared/admin/types.ts";
import { MAX_BUCKETS } from "../../../../src/shared/admin/types.ts";
import type { AdminApi, SortDirection } from "../api.ts";
import { filterKey, withPeriod } from "../filter-url.ts";
import { useRemote } from "../use-remote.ts";
import { Chart } from "../components/Chart.tsx";
import { FiltersBar, type FilterChange } from "../components/Filters.tsx";
import { MetricCard } from "../components/MetricCard.tsx";
import { EmptyStateCard, ErrorState, MetricsSkeleton, Skeleton } from "../components/States.tsx";
import { Card } from "../../components/ui/index.ts";

interface DashboardProps extends FilterChange {
  api: AdminApi;
  filters: AdminFilters;
  tz: string;
  anchor: string;
  onGranularity: (granularity: Granularity) => void;
  onFocusChange: (focused: boolean) => void;
  onPickDay: (day: string) => void;
  chartDir: SortDirection;
  onToggleChartDir: () => void;
  /** Bumps on manual/auto refresh. */
  refreshKey: number;
}

const GRANULARITY_BY_SPAN: Array<{ days: number; granularity: Granularity }> = [
  { days: 62, granularity: "day" },
  { days: 400, granularity: "week" },
  { days: 1900, granularity: "month" },
  { days: Number.POSITIVE_INFINITY, granularity: "year" },
];

function spanDays(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 86_400_000)) : 30;
}

/** Picks the finest granularity that stays under MAX_BUCKETS for the period. */
export function fitGranularity(granularity: Granularity, from: string, to: string): Granularity {
  const days = spanDays(from, to);
  const fits =
    granularity === "day"
      ? days
      : granularity === "week"
        ? Math.ceil(days / 7)
        : granularity === "month"
          ? Math.ceil(days / 30)
          : Math.ceil(days / 365);
  if (fits <= MAX_BUCKETS) return granularity;
  return (GRANULARITY_BY_SPAN.find((step) => Math.ceil(days / step.days) <= MAX_BUCKETS)?.granularity ??
    "year");
}

export function Dashboard(props: DashboardProps) {
  const { api, filters, tz } = props;
  const period = withPeriod(filters, props.anchor);
  const granularity = fitGranularity(filters.granularity, period.from!, period.to!);
  const query = { ...period, granularity, page: 1 };

  const summary = useRemote(
    (signal) => api.summary(query, signal),
    [filterKey(query), props.refreshKey],
  );
  const series = useRemote(
    (signal) => api.timeseries(query, signal),
    [filterKey(query), props.refreshKey],
  );

  const label = useCallback(
    (point: { bucketStart: string }) => formatBucketLabel(point.bucketStart, granularity, tz),
    [granularity, tz],
  );
  const tooltip = useCallback(
    (point: { bucketStart: string; transfers: number; volumeBytes: number }) =>
      `${label(point)}: ${formatNumber(point.transfers)} transferência(s), ${formatBytes(point.volumeBytes)}`,
    [label],
  );

  const data = summary.data;

  return (
    <section aria-labelledby="dash-title" className="space-y-4">
      <h2 id="dash-title" className="text-xl font-semibold tracking-tight">Visão geral</h2>
      <FiltersBar
        {...props}
        filters={filters}
        showGranularity
        granularity={granularity}
        onGranularity={props.onGranularity}
      >
        {data && (
          <p className="text-xs text-[var(--color-text-muted)]">
            {granularity !== filters.granularity && "Granularidade ajustada para caber no gráfico. "}
            {formatDate(data.period.from, tz)} a {formatDate(data.period.to, tz)} (fuso {tz}),{" "}
            {GRANULARITY_LABELS[granularity].toLowerCase()}
          </p>
        )}
      </FiltersBar>

      {summary.status === "error" && !summary.data && <ErrorState error={summary.error} onRetry={summary.reload} />}

      {!data && summary.status !== "error" && <MetricsSkeleton />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Arquivos enviados" value={formatNumber(data.totals.files)} hint="somente concluídos" />
            <MetricCard label="Volume total" value={formatBytes(data.totals.volumeBytes)} hint="somente concluídos" />
            <MetricCard label="Sessões" value={formatNumber(data.totals.sessions)} hint="no período" />
            <MetricCard
              label="Transferências"
              value={formatNumber(data.totals.transfers)}
              hint={`maior ${formatBytes(data.totals.largestSize)} · média ${formatBytes(data.totals.avgSize)}`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              {series.status === "error" && !series.data ? (
                <ErrorState error={series.error} onRetry={series.reload} />
              ) : !series.data ? (
                <Skeleton rows={4} label="Carregando gráfico" />
              ) : series.data.points.every((p) => p.transfers === 0) ? (
                <EmptyStateCard description="Nenhuma transferência no período selecionado." />
              ) : (
                <Chart
                  points={series.data.points}
                  granularity={series.data.granularity}
                  label={label}
                  tooltip={tooltip}
                  formatValue={(point) => formatBytes(point.volumeBytes)}
                  onSelectDay={granularity === "day" ? (point) => props.onPickDay(point.bucketStart.slice(0, 10)) : undefined}
                  sortDir={props.chartDir}
                  onToggleSortDir={props.onToggleChartDir}
                />
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold">Por situação</h3>
              <StatusBreakdown data={data.byStatus} />
              <h3 className="mt-4 text-sm font-semibold">Pareamentos recusados</h3>
              <p className="mt-1 text-2xl font-semibold tabular">{formatNumber(data.refusedPairings)}</p>
              <p className="text-xs text-[var(--color-text-muted)]">no período (IPs considerados)</p>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <RankCard
              title="Categorias"
              rows={data.byCategory.map((c) => ({
                key: c.category,
                label: CATEGORY_LABELS[c.category],
                count: c.count,
                extra: formatBytes(c.volumeBytes),
              }))}
            />
            <RankCard
              title="Extensões mais enviadas"
              rows={data.topExtensions.map((e) => ({
                key: e.extension,
                label: e.extension || "(sem extensão)",
                count: e.count,
                extra: formatBytes(e.volumeBytes),
              }))}
              formatKey={(k) => `.${k}`}
            />
            <RankCard
              title="IPs de celular mais frequentes"
              rows={data.topPhoneIps.map((ip) => ({ key: ip.ip, label: ip.ip, count: ip.count }))}
            />
          </div>
        </>
      )}

      {(summary.status === "error" || series.status === "error") && data && (
        <p role="alert" className="text-sm text-[var(--color-error)]">
          Não foi possível atualizar. Mostrando os últimos dados.{" "}
          <button type="button" className="underline" onClick={() => { summary.reload(); series.reload(); }}>
            Tentar de novo
          </button>
        </p>
      )}
    </section>
  );
}

function StatusBreakdown({ data }: { data: Array<{ status: TransferStatus; count: number }> }) {
  if (data.length === 0) return <p className="mt-1 text-sm text-[var(--color-text-muted)]">Sem dados.</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {data.map((row) => (
        <li key={row.status} className="flex justify-between">
          <span>{TRANSFER_STATUS_LABELS[row.status]}</span>
          <span className="tabular">{formatNumber(row.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function RankCard({
  title,
  rows,
  formatKey,
}: {
  title: string;
  rows: Array<{ key: string; label: string; count: number; extra?: string }>;
  formatKey?: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Sem dados no período.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" title={row.label}>{formatKey ? formatKey(row.label) : row.label}</span>
                <span className="shrink-0 tabular text-[var(--color-text-muted)]">
                  {formatNumber(row.count)}
                  {row.extra ? ` · ${row.extra}` : ""}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-[var(--color-border)]" aria-hidden>
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
