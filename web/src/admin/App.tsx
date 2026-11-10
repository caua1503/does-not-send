import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutDashboard, List, LogOut, RefreshCw, Send, Server } from "lucide-react";
import type { AdminFilters, Granularity } from "../../../src/shared/admin/types.ts";
import { Button, Card } from "../components/ui/index.ts";
import { createAdminApi } from "./api.ts";
import { filterKey, parseFilterParams, writeFilterParams } from "./filter-url.ts";
import { carryFilters, hrefFor, useHashRoute, type AdminRoute } from "./router.ts";
import { REFRESH_OPTIONS, useAutoRefresh } from "./use-refresh.ts";
import type { FilterChange } from "./components/Filters.tsx";
import { Login } from "./components/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { SessionsPage, TransfersPage } from "./pages/Lists.tsx";
import { NotFoundPage, SessionDetailPage, TransferDetailPage } from "./pages/Details.tsx";

type AuthState = { kind: "checking" } | { kind: "anonymous"; expired: boolean } | { kind: "in" };

const TZ = "America/Sao_Paulo";

/** Today's date in the admin timezone, not the browser's. */
function todayInZone(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

export function App() {
  const route = useHashRoute();
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });
  const api = useMemo(
    () =>
      createAdminApi(() =>
        setAuth((current) => (current.kind === "in" ? { kind: "anonymous", expired: true } : current)),
      ),
    [],
  );

  useEffect(() => {
    let alive = true;
    api.me().then(
      () => alive && setAuth({ kind: "in" }),
      () => alive && setAuth({ kind: "anonymous", expired: false }),
    );
    return () => {
      alive = false;
    };
  }, [api]);

  if (auth.kind === "checking") {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Card className="h-32 animate-pulse">{null}</Card>
      </main>
    );
  }

  if (auth.kind === "anonymous") {
    return (
      <Login
        expired={auth.expired}
        onLogin={async (username, password) => {
          await api.login(username, password);
          setAuth({ kind: "in" });
        }}
      />
    );
  }

  return (
    <Shell api={api} route={route} onLogout={() => setAuth({ kind: "anonymous", expired: false })} />
  );
}

function Shell({
  api,
  route,
  onLogout,
}: {
  api: ReturnType<typeof createAdminApi>;
  route: AdminRoute;
  onLogout: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoSeconds, setAutoSeconds] = useState<number>(0);
  const [typing, setTyping] = useState(false);
  const [chartDir, setChartDir] = useState<"asc" | "desc">("desc");
  const [now, setNow] = useState(() => new Date());

  useAutoRefresh(autoSeconds > 0, autoSeconds, () => {
    setRefreshKey((k) => k + 1);
    setNow(new Date());
  }, typing);

  const query = "query" in route ? route.query : new URLSearchParams();
  const filters = useMemo(() => parseFilterParams(query), [query.toString()]);
  const anchor = useMemo(() => todayInZone(TZ), [now]);

  const navigate = useCallback((params: URLSearchParams, path?: string) => {
    const target = path ?? currentPath();
    window.location.hash = hrefFor({ path: target, query: params }).slice(1);
  }, []);

  const change: FilterChange = useMemo(
    () => ({
      select: (patch) =>
        navigate(
          writeFilterParams(new URLSearchParams(query), {
            ...filters,
            ...(Object.keys(patch).length > 0 ? { page: 1 } : {}),
            ...patch,
          }),
        ),
      text: (key, value) =>
        navigate(writeFilterParams(new URLSearchParams(query), { ...filters, [key]: value || undefined, page: 1 })),
      reset: () => {
        const next = new URLSearchParams(query);
        for (const key of [...next.keys()]) {
          if (key !== "sort" && key !== "dir") next.delete(key);
        }
        navigate(next);
      },
    }),
    [filters, navigate, query],
  );

  const onGranularity = (granularity: Granularity): void => {
    navigate(writeFilterParams(new URLSearchParams(query), { ...filters, granularity }));
  };

  const onPickDay = (day: string): void => {
    const next = writeFilterParams(new URLSearchParams(), { ...filters, from: day, to: day, page: 1 });
    navigate(next, "/transfers");
  };

  const sessionsHref = hrefFor({ path: "/sessions", query: carryFilters(filters) });
  const transfersHref = hrefFor({ path: "/transfers", query: carryFilters(filters) });
  const active: "dashboard" | "sessions" | "transfers" =
    route.name === "sessions" || route.name === "session"
      ? "sessions"
      : route.name === "transfers" || route.name === "transfer"
        ? "transfers"
        : "dashboard";

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Send size={18} aria-hidden className="text-[var(--color-accent)]" />
            <span>does not send · painel</span>
          </a>
          <nav aria-label="Seções" className="order-3 flex w-full gap-1 sm:order-none sm:w-auto">
            <NavTab href="#/" label="Visão geral" icon={<LayoutDashboard size={14} aria-hidden />} current={active === "dashboard"} />
            <NavTab href={sessionsHref} label="Sessões" icon={<Server size={14} aria-hidden />} current={active === "sessions"} />
            <NavTab href={transfersHref} label="Transferências" icon={<List size={14} aria-hidden />} current={active === "transfers"} />
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <label htmlFor="admin-refresh" className="sr-only">Atualização automática</label>
            <select
              id="admin-refresh"
              value={autoSeconds}
              onChange={(e) => setAutoSeconds(Number(e.target.value))}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
            >
              {REFRESH_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === 0 ? "Manual" : `A cada ${s}s`}</option>
              ))}
            </select>
            <span aria-live="polite" className="hidden sm:inline tabular">
              {now.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRefreshKey((k) => k + 1);
                setNow(new Date());
              }}
              aria-label="Atualizar agora"
            >
              <RefreshCw size={14} aria-hidden /> Atualizar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void api.logout().finally(onLogout);
              }}
            >
              <LogOut size={14} aria-hidden /> Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Page
          route={route}
          api={api}
          filters={filters}
          change={change}
          anchor={anchor}
          queryKey={filterKey(filters)}
          refreshKey={refreshKey}
          onGranularity={onGranularity}
          onFocusChange={setTyping}
          onPickDay={onPickDay}
          onParams={(params) => navigate(params)}
          chartDir={chartDir}
          onToggleChartDir={() => setChartDir((d) => (d === "desc" ? "asc" : "desc"))}
        />
      </main>
    </div>
  );
}

function currentPath(): string {
  const hash = window.location.hash.slice(1);
  return hash.split("?")[0] || "/";
}

interface PageProps {
  route: AdminRoute;
  api: ReturnType<typeof createAdminApi>;
  filters: AdminFilters;
  change: FilterChange;
  anchor: string;
  queryKey: string;
  refreshKey: number;
  onGranularity: (granularity: Granularity) => void;
  onFocusChange: (focused: boolean) => void;
  onPickDay: (day: string) => void;
  onParams: (params: URLSearchParams) => void;
  chartDir: "asc" | "desc";
  onToggleChartDir: () => void;
}

function Page(props: PageProps) {
  const shared = {
    ...props.change,
    api: props.api,
    filters: props.filters,
    tz: TZ,
    anchor: props.anchor,
    onFocusChange: props.onFocusChange,
    refreshKey: props.refreshKey,
    queryKey: props.queryKey,
  };
  switch (props.route.name) {
    case "dashboard":
      return (
        <Dashboard
          {...shared}
          onGranularity={props.onGranularity}
          onPickDay={props.onPickDay}
          chartDir={props.chartDir}
          onToggleChartDir={props.onToggleChartDir}
        />
      );
    case "sessions":
      return <SessionsPage {...shared} params={props.route.query} onParams={props.onParams} />;
    case "transfers":
      return <TransfersPage {...shared} params={props.route.query} onParams={props.onParams} />;
    case "session":
      return <SessionDetailPage api={props.api} id={props.route.id} tz={TZ} />;
    case "transfer":
      return <TransferDetailPage api={props.api} id={props.route.id} tz={TZ} />;
    case "unknown":
      return <NotFoundPage />;
  }
}

function NavTab({
  href,
  label,
  icon,
  current,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  current: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={[
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-btn)] px-3 text-sm font-medium",
        current
          ? "bg-[var(--color-accent-light)] text-[var(--color-accent-hover)]"
          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </a>
  );
}
