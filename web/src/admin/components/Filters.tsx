import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { Category, TransferStatus } from "../../../../src/shared/admin/types.ts";
import {
  CATEGORIES,
  GRANULARITIES,
  type AdminFilters,
  type Granularity,
} from "../../../../src/shared/admin/types.ts";
import { TRANSFER_STATUSES } from "../../../../src/shared/admin/filters.ts";
import { CATEGORY_LABELS, TRANSFER_STATUS_LABELS } from "../../../../src/shared/admin/labels.ts";
import { Button, Card } from "../../components/ui/index.ts";
import { useDebounced } from "../use-debounced.ts";

export interface FilterChange {
  /** Non-text filters (selects, dates, sizes) applied immediately. */
  select: (patch: Partial<AdminFilters>) => void;
  /** Free-text filters: `q`, `ip`, `session`. */
  text: (key: "q" | "ip" | "session", value: string) => void;
  reset: () => void;
}

interface FiltersBarProps extends FilterChange {
  filters: AdminFilters;
  granularity: Granularity;
  showGranularity: boolean;
  onGranularity: (granularity: Granularity) => void;
  onFocusChange: (focused: boolean) => void;
  children?: ReactNode;
}

const MB = 1024 * 1024;

export function FiltersBar(props: FiltersBarProps) {
  const { filters, select, text, reset } = props;
  const granularityId = useId();
  const [open, setOpen] = useState(false);

  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => e.preventDefault()}
          role="search"
        >
          <label htmlFor="admin-q" className="sr-only">Buscar por nome de arquivo</label>
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <DebouncedTextInput
              id="admin-q"
              value={filters.q ?? ""}
              placeholder="Buscar arquivo"
              className="w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm"
              onChange={(value) => text("q", value)}
              onFocusChange={props.onFocusChange}
            />
          </div>
        </form>
        {props.showGranularity && (
          <div className="flex items-center gap-1">
            <label htmlFor={granularityId} className="sr-only">Granularidade</label>
            <select
              id={granularityId}
              value={props.granularity}
              onChange={(e) => props.onGranularity(e.target.value as Granularity)}
              className="rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm"
            >
              {GRANULARITIES.map((g) => (
                <option key={g} value={g}>
                  {granularityName(g)}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls="admin-filters-more"
          onClick={() => setOpen((v) => !v)}
        >
          Filtros
          <ChevronDown size={14} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          <X size={14} aria-hidden /> Limpar
        </Button>
      </div>

      {/* Collapsible: always visible from sm up, toggled by the button below it. */}
      <div id="admin-filters-more" className={open ? "mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "mt-3 hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4"}>
        <Field label="De" htmlFor="admin-from">
          <input
            id="admin-from"
            type="date"
            value={filters.from ?? ""}
            max={filters.to ?? undefined}
            onChange={(e) => select({ from: e.target.value || undefined, page: 1 })}
            onFocus={() => props.onFocusChange(true)}
            onBlur={() => props.onFocusChange(false)}
            className={inputClass}
          />
        </Field>
        <Field label="Até" htmlFor="admin-to">
          <input
            id="admin-to"
            type="date"
            value={filters.to ?? ""}
            min={filters.from ?? undefined}
            onChange={(e) => select({ to: e.target.value || undefined, page: 1 })}
            onFocus={() => props.onFocusChange(true)}
            onBlur={() => props.onFocusChange(false)}
            className={inputClass}
          />
        </Field>
        <Field label="IP (computador ou celular)" htmlFor="admin-ip">
          <DebouncedTextInput
            id="admin-ip"
            value={filters.ip ?? ""}
            placeholder="10.0.0.1"
            inputMode="decimal"
            className={inputClass}
            onChange={(value) => text("ip", value)}
            onFocusChange={props.onFocusChange}
          />
        </Field>
        <Field label="Sessão (id ou código)" htmlFor="admin-session">
          <DebouncedTextInput
            id="admin-session"
            value={filters.session ?? ""}
            placeholder="AAA-111"
            className={inputClass}
            onChange={(value) => text("session", value)}
            onFocusChange={props.onFocusChange}
          />
        </Field>
        <Field label="Categoria" htmlFor="admin-category">
          <select
            id="admin-category"
            value={filters.category ?? ""}
            onChange={(e) =>
              select({ category: (e.target.value || undefined) as Category | undefined, page: 1 })
            }
            className={inputClass}
          >
            <option value="">Todas</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </Field>
        <Field label="Situação" htmlFor="admin-status">
          <select
            id="admin-status"
            value={filters.status ?? ""}
            onChange={(e) =>
              select({ status: (e.target.value || undefined) as TransferStatus | undefined, page: 1 })
            }
            className={inputClass}
          >
            <option value="">Todas</option>
            {TRANSFER_STATUSES.map((s) => (
              <option key={s} value={s}>{TRANSFER_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Tamanho mínimo (MB)" htmlFor="admin-min">
          <SizeInput
            id="admin-min"
            value={filters.minSize}
            onChange={(bytes) => select({ minSize: bytes, page: 1 })}
            onFocusChange={props.onFocusChange}
          />
        </Field>
        <Field label="Tamanho máximo (MB)" htmlFor="admin-max">
          <SizeInput
            id="admin-max"
            value={filters.maxSize}
            onChange={(bytes) => select({ maxSize: bytes, page: 1 })}
            onFocusChange={props.onFocusChange}
          />
        </Field>
        {props.children && <div className="sm:col-span-2 lg:col-span-4">{props.children}</div>}
      </div>
    </Card>
  );
}

const inputClass =
  "w-full rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--color-text-muted)]">{label}</label>
      {children}
    </div>
  );
}

function granularityName(g: Granularity): string {
  return g === "day" ? "Dia" : g === "week" ? "Semana" : g === "month" ? "Mês" : "Ano";
}

/** Local state so every keystroke does not hit the URL; fires after 300ms. */
export function DebouncedTextInput({
  id,
  value,
  onChange,
  onFocusChange,
  className,
  placeholder,
  inputMode,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  className: string;
  placeholder?: string;
  inputMode?: "decimal" | "text";
}) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounced(draft, 300);
  const lastSent = useRef(value);

  // Adopt external changes (reset, back button) without fighting the user.
  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (debounced.trim() === lastSent.current.trim()) return;
    lastSent.current = debounced;
    onChange(debounced.trim());
  }, [debounced, onChange]);

  return (
    <input
      id={id}
      type="text"
      value={draft}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setDraft((d) => d.trim());
        }
      }}
      className={className}
    />
  );
}

function SizeInput({
  id,
  value,
  onChange,
  onFocusChange,
}: {
  id: string;
  value: number | undefined;
  onChange: (bytes: number | undefined) => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const mb = value !== undefined ? String(Math.round((value / MB) * 10) / 10) : "";
  return (
    <input
      id={id}
      type="number"
      min={0}
      step="0.1"
      inputMode="decimal"
      value={mb}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        const parsed = Number(raw);
        onChange(Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * MB) : undefined);
      }}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      placeholder="0"
      className={inputClass}
    />
  );
}
