import { useId, useState } from "react";
import type { Granularity, TimeseriesPoint } from "../../../../src/shared/admin/types.ts";
import type { SortDirection } from "../api.ts";

interface ChartProps {
  points: TimeseriesPoint[];
  granularity: Granularity;
  label: (point: TimeseriesPoint) => string;
  tooltip: (point: TimeseriesPoint) => string;
  formatValue: (point: TimeseriesPoint) => string;
  onSelectDay?: (point: TimeseriesPoint) => void;
  sortDir: SortDirection;
  onToggleSortDir: () => void;
}

const HEIGHT = 180;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 22;
const MIN_SLOT = 6;
const MAX_SLOT = 48;
const EVERY_OTHER_ABOVE = 24;

/**
 * Inline SVG bar chart (no chart library, no CDN): one bar per bucket, keyboard
 * reachable buttons, and a <table> alternative rendered for screen readers.
 */
export function Chart({
  points,
  granularity,
  label,
  tooltip,
  formatValue,
  onSelectDay,
  sortDir,
  onToggleSortDir,
}: ChartProps) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(points.length * MIN_SLOT, 320);
  const slot = Math.min(MAX_SLOT, Math.max(MIN_SLOT, Math.floor(width / Math.max(points.length, 1))));
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const max = Math.max(1, ...points.map((p) => p.volumeBytes));
  const barWidth = Math.max(2, slot - 2);
  const showEveryLabel = slot >= EVERY_OTHER_ABOVE ? 1 : Math.ceil(EVERY_OTHER_ABOVE / slot);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
        <span>Volume enviado por {granularityLabel(granularity)}</span>
        <button
          type="button"
          onClick={onToggleSortDir}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-accent-light)]"
          aria-label={`Ordenar por data ${sortDir === "desc" ? "mais antigo primeiro" : "mais recente primeiro"}`}
        >
          {sortDir === "desc" ? "Mais recente → antigo" : "Mais antigo → recente"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          className="block max-w-none"
        >
          <title id={titleId}>{`Gráfico de volume por ${granularityLabel(granularity)}`}</title>
          <line
            x1={0}
            x2={width}
            y1={HEIGHT - PADDING_BOTTOM}
            y2={HEIGHT - PADDING_BOTTOM}
            stroke="var(--color-border)"
          />
          {points.map((point, index) => {
            const value = point.volumeBytes;
            const h = value === 0 ? 0 : Math.max(1, (value / max) * plotHeight);
            const x = index * slot + 1;
            const y = HEIGHT - PADDING_BOTTOM - h;
            const isActive = active === index;
            return (
              <g key={point.bucketStart}>
                {h > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    rx={Math.min(3, barWidth / 2)}
                    fill={isActive ? "var(--color-accent-hover)" : "var(--color-accent)"}
                  />
                )}
                <rect
                  x={index * slot}
                  y={PADDING_TOP}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={tooltip(point)}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  onClick={() => onSelectDay?.(point)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectDay?.(point);
                    }
                  }}
                  className={onSelectDay ? "cursor-pointer" : ""}
                />
                {index % showEveryLabel === 0 && (
                  <text
                    x={index * slot + slot / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--color-text-muted)"
                  >
                    {label(point)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="min-h-5 text-xs text-[var(--color-text)] tabular" aria-live="polite">
        {active !== null && points[active] ? tooltip(points[active]!) : onSelectDay ? "Toque/clique numa barra para ver o dia." : ""}
      </p>
      <details className="text-xs text-[var(--color-text-muted)]">
        <summary>Ver como tabela</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              <th scope="col" className="py-1 font-medium">{granularityLabel(granularity)}</th>
              <th scope="col" className="py-1 font-medium">Transferências</th>
              <th scope="col" className="py-1 text-right font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.bucketStart}>
                <td className="py-1">{label(point)}</td>
                <td className="py-1 tabular">{point.transfers}</td>
                <td className="py-1 text-right tabular">{formatValue(point)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function granularityLabel(granularity: Granularity): string {
  return granularity === "day"
    ? "dia"
    : granularity === "week"
      ? "semana"
      : granularity === "month"
        ? "mês"
        : "ano";
}
