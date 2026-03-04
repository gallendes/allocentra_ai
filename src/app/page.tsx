// src/app/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { ChevronDown, Trash2 } from "lucide-react";

type Timeframe = "1d" | "5d" | "1m" | "6m" | "1y" | "5y";

type PortfolioPosition = {
  symbol: string;
  name?: string;

  current_price: number;
  shares: number;

  day_gain: number;
  day_gain_percent: number;

  pnl: number;
  pnl_percent: number;

  value: number;
  volatility?: number;

  allocation_percent: number;
};

type PortfolioResponse = {
  total_value: number;

  total_day_gain: number;
  total_day_gain_percent: number;

  total_pnl: number;
  total_pnl_percent: number;

  industry_allocations?: Record<string, number>;
  size_allocations?: Record<string, number>;

  positions: PortfolioPosition[];
};

type TimeSeriesPoint = {
  datetime: string; // "YYYY-MM-DD"
  portfolio_value: number;
};

type TimeSeriesResponse = {
  from: string;
  to: string;
  range_pnl: number;
  range_pnl_percent: number;
  history: TimeSeriesPoint[]; // returned DESC by API
};

type TradeRow = {
  id: number;
  username: string;
  symbol: string;
  type: "BUY" | "SELL";
  executed_at: string; // "YYYY-MM-DD"
  shares: number;
  price: number;
};

const SHARE_STEP = 1;

function fmtMoney(n: number, digits = 2) {
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number, digits = 2) {
  const x = Number.isFinite(n) ? n : 0;
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtNum(n: number, digits = 2) {
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function roundTo(n: number, digits: number) {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function formatDateOnly(value?: string) {
  if (!value) return "";

  const d = new Date(value);
  if (isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function localDateISO(d = new Date()) {
  // YYYY-MM-DD in the user's *local* timezone (avoids toISOString() UTC shift)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function labelizeKey(k: string) {
  return k
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
}

function signClass(v: number) {
  if (!Number.isFinite(v) || v === 0) return "text-slate-700 bg-slate-50 border-slate-200";
  return v > 0
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : "text-rose-700 bg-rose-50 border-rose-200";
}

function signArrow(v: number) {
  if (!Number.isFinite(v) || v === 0) return "•";
  return v > 0 ? "▲" : "▼";
}

function safeRecordEntries(obj?: Record<string, number>) {
  if (!obj) return [];
  return Object.entries(obj)
      .map(([k, v]) => [k, Number(v)] as const)
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
}

export default function Page() {
  const [username] = useState("sea_otter");

  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>("1m");

  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [ts, setTs] = useState<TimeSeriesResponse | null>(null);

  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [loadingTs, setLoadingTs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tradesBySymbol, setTradesBySymbol] = useState<Record<string, TradeRow[]>>({});
  const [loadingTrades, setLoadingTrades] = useState<Record<string, boolean>>({});

  const [tradeModal, setTradeModal] = useState<{
    open: boolean;
    symbol: string | null;
    type: "BUY" | "SELL";
  }>({ open: false, symbol: null, type: "BUY" });

  const [tradeQty, setTradeQty] = useState<number>(1);
  const [tradeDate, setTradeDate] = useState<string>(localDateISO());
  const [tradePrice, setTradePrice] = useState<number>(0);
  const [savingTrade, setSavingTrade] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [deletingTradeId, setDeletingTradeId] = useState<number | null>(null);

  const todayLabel = useMemo(() => {
    return new Date().toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }, []);

  async function fetchPortfolio() {
    setLoadingPortfolio(true);
    setError(null);
    try {
      setRefreshing(true)
      const res = await fetch(`/api/portfolio?username=${encodeURIComponent(username)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`api/portfolio failed: ${res.status}`);
      const data = (await res.json()) as PortfolioResponse;
      setPortfolio({
        ...data,
        total_day_gain: roundTo(Number(data.total_day_gain), 2),
        total_day_gain_percent: roundTo(Number(data.total_day_gain_percent), 4),
      });
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message ?? "Failed to load portfolio");
      setPortfolio(null);
    } finally {
      setTimeout(() => setRefreshing(false), 400)
      setLoadingPortfolio(false);
    }
  }

  async function fetchTimeSeries(tf: Timeframe) {
    setLoadingTs(true);
    setError(null);
    try {
      setRefreshing(true)
      const res = await fetch(
          `/api/time-series?username=${encodeURIComponent(username)}&timeframe=${encodeURIComponent(tf)}`,
          { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`api/time-series failed: ${res.status}`);
      const data = (await res.json()) as TimeSeriesResponse;
      setTs(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load time series");
      setTs(null);
    } finally {
      setTimeout(() => setRefreshing(false), 400)
      setLoadingTs(false);
    }
  }


  async function fetchTradesForSymbol(symbol: string) {
    setLoadingTrades((m) => ({ ...m, [symbol]: true }));
    try {
      const res = await fetch(
          `/api/trades?username=${encodeURIComponent(username)}&symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`api/trades failed: ${res.status}`);
      const rows = (await res.json()) as TradeRow[];
      setTradesBySymbol((m) => ({ ...m, [symbol]: rows }));
      return rows;
    } catch {
      setTradesBySymbol((m) => ({ ...m, [symbol]: [] }));
      return [];
    } finally {
      setLoadingTrades((m) => ({ ...m, [symbol]: false }));
    }
  }

  async function ensureTrades(symbol: string) {
    if (tradesBySymbol[symbol]) return;
    await fetchTradesForSymbol(symbol);
  }

  async function submitTrade() {
    if (!tradeModal.symbol) return;

    setSavingTrade(true);
    setTradeError(null);

    try {
      const payload = {
        username,
        symbol: tradeModal.symbol,
        type: tradeModal.type,
        executed_at: tradeDate, // YYYY-MM-DD
        shares: Number(tradeQty),
        price: Number(tradePrice),
      };

      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        const msg = j?.error || `api/trade failed: ${res.status}`;
        throw new Error(msg);
      }

      await Promise.all([
        fetchPortfolio(),
        fetchTimeSeries(timeframe),
        fetchTradesForSymbol(tradeModal.symbol),
      ]);

      setTradeModal({ open: false, symbol: null, type: "BUY" });
    } catch (e: any) {
      setTradeError(e?.message ?? "Failed to save trade");
    } finally {
      setSavingTrade(false);
    }
  }

  async function deleteTrade(symbol: string, idRaw: number) {
    const id = Number(idRaw);

    if (!Number.isFinite(id) || id <= 0) {
      console.error("Invalid trade ID:", id);
      return
    };

    setDeletingTradeId(id);
    setError(null);

    try {
      const res = await fetch(
          `/api/trade?id=${encodeURIComponent(String(id))}&username=${encodeURIComponent(username)}`,
          { method: "DELETE" }
      );

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        const msg = j?.error || `api/trade DELETE failed: ${res.status}`;
        throw new Error(msg);
      }

      await Promise.all([
        fetchPortfolio(),
        fetchTimeSeries(timeframe),
        fetchTradesForSymbol(symbol),
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete trade");
    } finally {
      setDeletingTradeId(null);
    }
  }

  function openTradeModal(symbol: string, type: "BUY" | "SELL", defaultPrice?: number) {
    setTradeError(null);
    setTradeModal({ open: true, symbol, type });
    setTradeQty(1);
    setTradeDate(localDateISO());
    setTradePrice(Number.isFinite(defaultPrice as any) ? Number(defaultPrice) : 0);
  }

  function closeTradeModal() {
    if (savingTrade) return;
    setTradeModal({ open: false, symbol: null, type: "BUY" });
  }

  useEffect(() => {
    if (!username) return;

    const refresh = () => {
      fetchPortfolio();
    };

    refresh(); // initial load

    const intervalId = window.setInterval(refresh, 60 * 1000);

    const onFocus = () => refresh();

    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [username]);

  useEffect(() => {
    if (!username) return;

    const refresh = () => {
      fetchTimeSeries(timeframe);
    };

    refresh(); // initial load

    const intervalId = window.setInterval(refresh, 60 * 1000);

    const onFocus = () => refresh();

    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [username, timeframe]);

  useEffect(() => {
    if (!tradeModal.open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTradeModal();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tradeModal.open, savingTrade]);

  const chartData = useMemo(() => {
    const hist = ts?.history ?? [];
    // API returns DESC; recharts is nicer ASC for left->right time.
    const asc = [...hist].reverse();
    return asc.map((p) => ({
      datetime: p.datetime,
      value: Number(p.portfolio_value),
    }));
  }, [ts]);

  const pieData = useMemo(() => {
    const pos = portfolio?.positions ?? [];
    return pos
        .map((p) => ({
          name: p.symbol,
          value: Number(p.allocation_percent),
        }))
        .filter((x) => Number.isFinite(x.value) && x.value > 0);
  }, [portfolio]);

  const industryRows = useMemo(() => safeRecordEntries(portfolio?.industry_allocations), [portfolio]);
  const sizeRows = useMemo(() => safeRecordEntries(portfolio?.size_allocations), [portfolio]);

  const anyLoading = loadingPortfolio || loadingTs;

  const colors = ["#16A34A","#60A5FA","#F59E0B","#84CC16","#06B6D4","#6366F1","#F97316","#0ea5e9"];

  return (
      <div className="min-h-screen bg-secondary">
        <div className="mx-auto max-w-6xl px-4 py-6">
          {/* Header */}
          <header className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Allocentra AI</h1>
            <p className="mt-1 text-sm text-slate-600">AI-Powered Portfolio Intelligence</p>
          </header>
          {/* Top row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left: Line graph card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <div className={`text-2xl font-semibold tracking-tight text-slate-900 ${refreshing ? "animate-pulse opacity-60" : ""}`}>
                      {fmtMoney(portfolio?.total_value ?? 0)}
                    </div>
                    <div
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${signClass(
                            ts?.range_pnl ?? 0
                        )} ${refreshing ? "animate-pulse " : ""}`}
                        title="Range P&L"
                    >
                      <span className="font-medium">{signArrow(ts?.range_pnl ?? 0)}</span>
                      <span className="font-medium">{fmtMoney(ts?.range_pnl ?? 0)}</span>
                      <span className="opacity-80">{fmtPct(ts?.range_pnl_percent ?? 0, 2)}</span>
                    </div>
                  </div>

                  <div className="mt-1 text-sm text-slate-500">{todayLabel}</div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(["1d", "5d", "1m", "6m", "1y", "5y"] as Timeframe[]).map((tf) => {
                    const active = tf === timeframe;
                    return (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={[
                              "rounded-full border px-2 py-1 text-sm transition",
                              active
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                        >
                          {tf.toUpperCase()}
                        </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis
                        dataKey="datetime"
                        tick={{ fontSize: 12 }}
                        minTickGap={24}
                        tickFormatter={(v) => {
                          if (!v) return "";
                          const d = new Date(v);
                          if (isNaN(d.getTime())) return "";
                          return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
                        }}
                    />
                    <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => {
                          const n = Number(v);
                          if (!Number.isFinite(n)) return "";
                          return `${Math.round(n).toLocaleString()}`;
                        }}
                        width={70}
                    />
                    <Tooltip
                        formatter={(value: any) => fmtMoney(Number(value))}
                        labelFormatter={(label: any) => {
                          if (!label) return "";
                          const d = new Date(label);
                          if (isNaN(d.getTime())) return "";
                          return d.toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "2-digit",
                          });
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="value"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {loadingTs ? "Loading history…" : ts ? `From ${formatDateOnly(ts.from)} to ${formatDateOnly(ts.to)}` : "—"}
              </div>
            </div>
            {/* Middle: Gains + allocations */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3 flex flex-col">
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl border p-3 ${signClass(portfolio?.total_day_gain ?? 0)} ${refreshing ? "animate-pulse " : ""}`}>
                  <div className="text-xs font-medium uppercase tracking-wide opacity-80">Day Gain</div>
                  <div className="mt-1 text-lg font-semibold">
                    {fmtMoney(portfolio?.total_day_gain ?? 0)}
                  </div>
                  <div className="text-sm opacity-90">{fmtPct(portfolio?.total_day_gain_percent ?? 0, 2)}</div>
                </div>

                <div className={`rounded-xl border p-3 ${signClass(portfolio?.total_pnl ?? 0)} ${refreshing ? "animate-pulse " : ""}`}>
                  <div className="text-xs font-medium uppercase tracking-wide opacity-80">Total Gain</div>
                  <div className="mt-1 text-lg font-semibold">{fmtMoney(portfolio?.total_pnl ?? 0)}</div>
                  <div className="text-sm opacity-90">{fmtPct(portfolio?.total_pnl_percent ?? 0, 2)}</div>
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Allocation by Industry
                </div>
                <div className="mt-2 space-y-2">
                  {industryRows.length === 0 ? (
                      <div className="text-sm text-slate-500">—</div>
                  ) : (
                      industryRows.map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-3">
                            <div className="truncate text-sm text-slate-800">{labelizeKey(k)}</div>
                            <div className="text-sm font-medium text-slate-900">{fmtPct(v / 100, 1)}</div>
                          </div>
                      ))
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Allocation by Company Size
                </div>
                <div className="mt-2 space-y-2">
                  {sizeRows.length === 0 ? (
                      <div className="text-sm text-slate-500">—</div>
                  ) : (
                      sizeRows.map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-3">
                            <div className="truncate text-sm text-slate-800">{labelizeKey(k)}</div>
                            <div className="text-sm font-medium text-slate-900">{fmtPct(v / 100, 1)}</div>
                          </div>
                      ))
                  )}
                </div>
              </div>

              <div className="mt-auto pt-4 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  {refreshing && (
                      <div className="h-3 w-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                  )}
                  <span>{refreshing ? "Updating prices…" : "Prices updated"}</span>
                </div>

                {lastUpdated && (
                    <span>{lastUpdated.toLocaleTimeString()}</span>
                )}
              </div>
            </div>

            {/* Right: Pie chart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
              <div className="text-sm font-semibold text-slate-900">Portfolio Distribution</div>
              <div className={`mt-2 h-60 w-full ${refreshing ? "animate-pulse" : ""}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={15}
                        outerRadius={95}
                        paddingAngle={2}>
                      {pieData.map((_, idx) => (
                          <Cell
                              key={`cell-${idx}`}
                              fill={colors[idx % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => `${fmtPct(v ?? 0, 2)}`} />
                    <Legend layout="horizontal" align="left" verticalAlign="bottom" height={12} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Bottom table */}
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Positions</div>
              <div className="text-xs text-slate-500">
                {anyLoading ? "Loading…" : portfolio ? `${portfolio.positions.length} holdings` : "—"}
              </div>
            </div>

            {error ? (
                <div className="border-t border-slate-200 px-4 py-3 text-sm text-rose-700">{error}</div>
            ) : null}

            <div className="overflow-x-auto border-t border-slate-200">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3">Day Gain</th>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3">Total Gain</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Volatility (1Y)</th>
                  <th className="px-4 py-3"></th>
                </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                {(portfolio?.positions ?? []).map((p) => {
                  const isOpen = !!expanded[p.symbol];
                  return (
                      <React.Fragment key={p.symbol}>
                        <tr className="hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-medium text-slate-900">{p.symbol}</td>
                          <td className="px-4 py-3 text-slate-700">{p.name ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-700">{fmtMoney(p.current_price ?? 0)}</td>
                          <td className="px-4 py-3 text-slate-700">{fmtNum(p.shares ?? 0, 2)}</td>
                          <td className={`px-4 py-3 ${p.day_gain >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {fmtMoney(p.day_gain ?? 0)}
                          </td>
                          <td className={`px-4 py-3 ${p.day_gain_percent >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {fmtPct(p.day_gain_percent ?? 0, 2)}
                          </td>
                          <td className={`px-4 py-3 ${p.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {fmtMoney(p.pnl ?? 0)}
                          </td>
                          <td className={`px-4 py-3 ${p.pnl_percent >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {fmtPct(p.pnl_percent ?? 0, 2)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{fmtMoney(p.value ?? 0)}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {p.volatility == null ? "—" : fmtPct(p.volatility, 2)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                                className="inline-flex items-center justify-center rounded-full bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
                                onClick={async () => {
                                  const next = !isOpen;
                                  setExpanded((m) => ({ ...m, [p.symbol]: next }));
                                  if (next) await ensureTrades(p.symbol);
                                }}
                                aria-label={isOpen ? "Collapse" : "Expand"}
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}/>
                            </button>
                          </td>
                        </tr>

                        {isOpen ? (
                            <tr className="bg-white">
                              <td colSpan={11} className="px-4 py-4">
                                <div className="rounded-xl border border-slate-200" >
                                  <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-xs font-semibold tracking-wide text-slate-500">
                                      Ledger Trades — {p.symbol}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button
                                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                          onClick={() => openTradeModal(p.symbol, "BUY", p.current_price)}
                                          type="button"
                                      >
                                        + New Purchase
                                      </button>
                                      <button
                                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                          onClick={() => openTradeModal(p.symbol, "SELL", p.current_price)}
                                          type="button"
                                      >
                                        - New Sell
                                      </button>

                                      <div className="text-xs text-slate-500">
                                        {loadingTrades[p.symbol]
                                            ? "Loading…"
                                            : `${(tradesBySymbol[p.symbol] ?? []).length} rows`}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="overflow-x-auto border-t border-slate-200">
                                    <table className="w-full min-w-[700px] text-left text-sm">
                                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                      <tr>
                                        <th className="px-3 py-2 w-1/5">Date</th>
                                        <th className="px-3 py-2 w-1/6">Type</th>
                                        <th className="px-3 py-2 w-3/10">Price</th>
                                        <th className="px-3 py-2">Quantity</th>
                                        <th className="px-3 py-2">Value</th>
                                        <th className="px-3 py-2 text-right"> </th>
                                      </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                      {(tradesBySymbol[p.symbol] ?? []).map((t) => {
                                        const date = new Date(t.executed_at);
                                        const uiDate = date.toLocaleDateString(undefined, {month:"short", day:"2-digit", year:"numeric"});
                                        const value = (Number(t.price) || 0) * (Number(t.shares) || 0);
                                        return (
                                            <tr key={t.id} className="hover:bg-slate-50/60">
                                              <td className="px-3 py-2 text-slate-700">{uiDate}</td>
                                              <td
                                                  className={[
                                                    "px-3 py-2 font-medium",
                                                    t.type === "BUY" ? "text-emerald-700" : "text-rose-700",
                                                  ].join(" ")}
                                              >
                                                {t.type}
                                              </td>
                                              <td className="px-3 py-2 text-slate-700">{fmtMoney(Number(t.price) || 0)}</td>
                                              <td className="px-3 py-2 text-slate-700">{fmtNum(Number(t.shares) || 0, 2)}</td>
                                              <td className="px-3 py-2 text-slate-900">{fmtMoney(value)}</td>
                                              <td className="px-3 py-2 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => deleteTrade(p.symbol, t.id)}
                                                    disabled={deletingTradeId === t.id}
                                                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                                    aria-label="Delete trade"
                                                    title="Delete"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </button>
                                              </td>
                                            </tr>
                                        );
                                      })}

                                      {!loadingTrades[p.symbol] && (tradesBySymbol[p.symbol] ?? []).length === 0 ? (
                                          <tr>
                                            <td colSpan={6} className="px-3 py-3 text-sm text-slate-500">
                                              No trades found.
                                            </td>
                                          </tr>
                                      ) : null}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                        ) : null}
                      </React.Fragment>
                  );
                })}

                {!anyLoading && (portfolio?.positions?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-sm text-slate-500">
                        No positions yet.
                      </td>
                    </tr>
                ) : null}

                {anyLoading && !portfolio ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-sm text-slate-500">
                        Loading…
                      </td>
                    </tr>
                ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trade modal */}
          {tradeModal.open ? (
              <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  onMouseDown={(e) => {
                    // close when clicking the backdrop (not the panel)
                    if (e.target === e.currentTarget) closeTradeModal();
                  }}
              >
                <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl sm:min-w-[600px]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">
                        {tradeModal.type === "BUY" ? "Record a purchase" : "Record a sale"}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {tradeModal.symbol}
                      </div>
                    </div>

                    <button
                        className="rounded-full border border-slate-200 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        onClick={closeTradeModal}
                        disabled={savingTrade}
                        aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 ">
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-slate-600">Quantity</label>
                      <div className="mt-1 flex items-center rounded-md border border-slate-200">
                        <button
                            className="px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            onClick={() =>
                                setTradeQty((q) => (q > 0 ? Number((q - SHARE_STEP).toFixed(8)) : 0))
                            }
                            disabled={savingTrade}
                            type="button"
                        >
                          −
                        </button>
                        <input
                            className="w-full border-x border-slate-200 px-1 py-1.5 text-center text-sm outline-none"
                            type="number"
                            min={0}
                            step={0.00000001}
                            value={tradeQty}
                            onChange={(e) => setTradeQty(Number(e.target.value))}
                            disabled={savingTrade}
                        />
                        <button
                            className="px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            onClick={() =>
                                setTradeQty((q) => Number((q + SHARE_STEP).toFixed(8)))
                            }
                            disabled={savingTrade}
                            type="button"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-slate-600">Transaction date</label>
                      <input
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                          type="date"
                          value={tradeDate}
                          onChange={(e) => setTradeDate(e.target.value)}
                          disabled={savingTrade}
                      />
                    </div>

                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-slate-600">Transaction price</label>
                      <input
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                          type="number"
                          step={0.01}
                          min={0}
                          value={tradePrice}
                          onChange={(e) => setTradePrice(Number(e.target.value))}
                          disabled={savingTrade}
                      />
                    </div>
                  </div>

                  {tradeError ? (
                      <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {tradeError}
                      </div>
                  ) : null}

                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                        className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        onClick={closeTradeModal}
                        disabled={savingTrade}
                        type="button"
                    >
                      Cancel
                    </button>

                    <button
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        onClick={submitTrade}
                        disabled={savingTrade || !tradeModal.symbol}
                        type="button"
                    >
                      {savingTrade ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
          ) : null}

        </div>
      </div>
  );
}
