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

import html2canvas from "html2canvas-pro";

import { Sparkles } from "lucide-react";

import ReactMarkdown from "react-markdown";
import type {
  AnalyzeUIResponse,
  QuickAction,
  RebalanceTrade,
  StrategicAction,
} from "@/lib/ai/contracts";
import { executeRebalancePlan } from "@/lib/ai/rebalanceExecutor";
import { performQuickAction } from "@/lib/ai/uiActions";

type Timeframe = "1d" | "5d" | "1m" | "6m" | "1y" | "5y";

type PortfolioPosition = {
  symbol: string;
  name?: string;
  industry_sector?: string;
  company_size?: string;

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

  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(x * 100);

  return `${formatted}%`;
}

function fmtNum(n: number, digits = 2) {
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDateOnly(value?: string) {
  if (!value) return "";
  const datePrefix = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (datePrefix) {
    const [, year, month, day] = datePrefix;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(Number(year), Number(month) - 1, Number(day)));
  }

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

function toEnumKey(value?: string) {
  return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
}

function formatCompanySizeLabel(value?: string) {
  switch (value) {
    case "mega_cap":
      return "Mega Cap";
    case "large_cap":
      return "Large Cap";
    case "small_cap":
      return "Small Cap";
    default:
      return value ? labelizeKey(value) : "—";
  }
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

function formatTradeSymbolSummary(trades: RebalanceTrade[], side: "buy" | "sell") {
  const symbols = [...new Set(
    trades
      .filter((trade) => trade.side === side)
      .map((trade) => trade.symbol)
      .filter(Boolean)
  )];

  if (symbols.length === 0) return null;
  if (symbols.length <= 2) return `${side === "buy" ? "Buy" : "Sell"}: ${symbols.join(", ")}`;
  return `${side === "buy" ? "Buy" : "Sell"}: ${symbols.slice(0, 2).join(", ")} +${symbols.length - 2}`;
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
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [strategicActions, setStrategicActions] = useState<StrategicAction[]>([]);
  const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExecutingAction, setAiExecutingAction] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [highlightedIndustry, setHighlightedIndustry] = useState<string | null>(null);
  const [highlightedCompanySize, setHighlightedCompanySize] = useState<string | null>(null);

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
      setPortfolio(data);
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

  async function fetchPriceForDate(symbol: string, date: string) {
    try {
      const res = await fetch(
          `/api/price-at-date?symbol=${symbol}&date=${date}`
      );

      if (!res.ok) return;

      const data = await res.json();

      setTradePrice(Number(data.price));
    } catch (err) {
      console.error("Price lookup error:", err);
    }
  }

  async function ensureTrades(symbol: string) {
    if (tradesBySymbol[symbol]) return;
    await fetchTradesForSymbol(symbol);
  }

  function flashIndustry(industry: string) {
    setHighlightedIndustry(industry);
    window.setTimeout(() => {
      setHighlightedIndustry((current) => (current === industry ? null : current));
    }, 1800);
  }

  function flashCompanySize(companySize: string) {
    setHighlightedCompanySize(companySize);
    window.setTimeout(() => {
      setHighlightedCompanySize((current) => (current === companySize ? null : current));
    }, 1800);
  }

  function getAIActionKey(action: { action: string; label: string; strategy?: string; symbol?: string; timeframe?: string; industry?: string; company_size?: string; }) {
    return [
      action.action,
      action.label,
      action.strategy ?? "",
      action.symbol ?? "",
      action.timeframe ?? "",
      action.industry ?? "",
      action.company_size ?? "",
    ].join("|");
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


  async function handleAnalyzeWithAI(rerun: boolean = false) {
    if (aiInsights && !rerun) {
      console.log("AI insights:", aiInsights);
      setAiPanelOpen(true);
      return;
    }

    setAiInsights(null);
    setStrategicActions([]);
    setQuickActions([]);
    setAiPanelOpen(true);
    setAiLoading(true);
    setAiError(null);

    try {
      const el = document.getElementById("dashboard");
      if (!el) throw new Error("Dashboard element not found");

      const canvas = await html2canvas(el, {
        useCORS: true,
        scale: 2
      });

      const image = canvas.toDataURL("image/png");

      const res = await fetch("/api/ai/analyze-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, username }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);

        throw new Error(
            errData?.error || `AI analysis failed (${res.status})`
        );
      }

      const data = (await res.json()) as AnalyzeUIResponse;
      console.log("AI analysis response:", data);

      const insights = (data.insights ?? "").trim();
      setAiInsights(insights || "No insights returned.");
      setStrategicActions(Array.isArray(data.strategic_actions) ? data.strategic_actions : []);
      setQuickActions(Array.isArray(data.quick_actions) ? data.quick_actions : []);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Failed to analyze dashboard");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleQuickAction(action: QuickAction) {
    const actionKey = getAIActionKey(action);
    setAiExecutingAction(actionKey);
    setAiError(null);

    try {
      await performQuickAction(action, {
        setExpanded,
        ensureTrades,
        setTimeframe,
        flashIndustry,
        flashCompanySize,
      });
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Failed to run quick action");
    } finally {
      setAiExecutingAction(null);
    }
  }

  async function handleStrategicAction(action: StrategicAction) {
    const actionKey = getAIActionKey(action);

    if (action.rebalance_plan.trades.length === 0) {
      setAiError("This rebalance plan does not contain any executable trades.");
      return;
    }

    setAiExecutingAction(actionKey);
    setAiError(null);

    try {
      await executeRebalancePlan(action.rebalance_plan, { username });

      const touchedSymbols = [...new Set(action.rebalance_plan.trades.map((trade) => trade.symbol))]
        .filter((symbol) => tradesBySymbol[symbol]);

      await Promise.all([
        fetchPortfolio(),
        fetchTimeSeries(timeframe),
        ...touchedSymbols.map((symbol) => fetchTradesForSymbol(symbol)),
      ]);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Failed to execute rebalance plan");
    } finally {
      setAiExecutingAction(null);
    }
  }

  useEffect(() => {
    if (!username) return;

    const refresh = () => {
      fetchPortfolio();
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

  const cleanedInsights = aiInsights?.replace(/\n\s*\n+/g, "\n\n");

  return (
      <div className="min-h-screen bg-secondary">
        <div id="dashboard" className="mx-auto w-full max-w-[88rem] px-4 py-6 origin-top" style={{ transform:"scale(0.95)"}}>
          {/* Header */}
          <header className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Allocentra AI
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                AI-Powered Portfolio Intelligence
              </p>
            </div>
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
                      <div className="text-xs text-slate-500">—</div>
                  ) : (
                      industryRows
                          .filter(([_, v]) => v !== 0)
                          .map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-3">
                            <div className="truncate text-xs text-slate-800">{labelizeKey(k)}</div>
                            <div className="text-xs font-medium text-slate-900">{fmtPct(v / 100, 1)}</div>
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
                      <div className="text-xs text-slate-500">—</div>
                  ) : (
                      sizeRows
                          .filter(([_, v]) => v !== 0)
                          .map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-3">
                            <div className="truncate text-xs text-slate-800">{labelizeKey(k)}</div>
                            <div className="text-xs font-medium text-slate-900">{fmtPct(v / 100, 1)}</div>
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
              <table className="w-full min-w-[1360px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-[96px] px-4 py-3">Symbol</th>
                  <th className="min-w-[170px] px-4 py-3">Name</th>
                  <th className="min-w-[210px] px-4 py-3 whitespace-nowrap">Industry Sector</th>
                  <th className="min-w-[130px] px-4 py-3 whitespace-nowrap">Company Size</th>
                  <th className="w-[110px] px-4 py-3">Price</th>
                  <th className="w-[90px] px-4 py-3">Quantity</th>
                  <th className="w-[120px] px-4 py-3"></th>
                  <th className="w-[120px] px-4 py-3">Day Gain</th>
                  <th className="w-[120px] px-4 py-3"></th>
                  <th className="w-[120px] px-4 py-3">Total Gain</th>
                  <th className="w-[110px] px-4 py-3">Value</th>
                  <th className="w-[120px] px-4 py-3">Volatility (1Y)</th>
                  <th className="w-[60px] px-4 py-3"></th>
                </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                {(portfolio?.positions ?? []).map((p) => {
                  const isOpen = !!expanded[p.symbol];
                  const industryMatch =
                    highlightedIndustry &&
                    toEnumKey(p.industry_sector) === toEnumKey(highlightedIndustry);
                  const sizeMatch =
                    highlightedCompanySize &&
                    toEnumKey(p.company_size) === toEnumKey(highlightedCompanySize);
                  const rowHighlightClass = industryMatch
                    ? "bg-amber-50/90 animate-pulse"
                    : sizeMatch
                        ? "bg-sky-50/90 animate-pulse"
                        : "hover:bg-slate-50/60";
                  return (
                      <React.Fragment key={p.symbol}>
                        <tr className={rowHighlightClass}>
                          <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{p.symbol}</td>
                          <td className="px-4 py-3 text-slate-700">{p.name ?? "—"}</td>
                          <td className="min-w-[210px] px-4 py-3 text-slate-700">{p.industry_sector ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatCompanySizeLabel(p.company_size)}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtMoney(p.current_price ?? 0)}</td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtNum(p.shares ?? 0, 2)}</td>
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
                              <td colSpan={13} className="px-4 py-4">
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
                                        const uiDate = formatDateOnly(t.executed_at);
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
                      <td colSpan={13} className="px-4 py-6 text-sm text-slate-500">
                        No positions yet.
                      </td>
                    </tr>
                ) : null}

                {anyLoading && !portfolio ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-6 text-sm text-slate-500">
                        Loading…
                      </td>
                    </tr>
                ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/*{(aiLoading || aiError || aiInsights) ? (*/}
          {/*    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">*/}
          {/*      <div className="text-sm font-semibold text-slate-900">AI Analysis</div>*/}
          {/*      <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">*/}
          {/*        <ReactMarkdown>*/}
          {/*          {aiLoading ? "Analyzing dashboard..." : aiError ? aiError : aiInsights}*/}
          {/*        </ReactMarkdown>*/}
          {/*      </div>*/}
          {/*    </div>*/}
          {/*) : null}*/}

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
                          onChange={(e) => {
                            const newDate = e.target.value;
                            setTradeDate(e.target.value);
                            if (tradeModal.symbol && newDate) {
                              fetchPriceForDate(tradeModal.symbol, newDate);
                            }
                          }}
                          disabled={savingTrade}
                      />
                    </div>

                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-slate-600">Transaction price</label>
                      <input
                          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 transition-all duration-200 hover:border-slate-300"
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

        {/* AI Floating Action Button */}
        <div className="fixed bottom-6 right-6 z-40">
          <button
              onClick={() => handleAnalyzeWithAI()}
              disabled={aiLoading}
              className="flex items-center justify-center w-14 h-14 rounded-full bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            <Sparkles className={`h-6 w-6 ${aiLoading ? "animate-pulse" : ""}`} />
          </button>
        </div>

        {aiPanelOpen && (
            <div className="fixed bottom-6 right-6 z-50 w-[calc(100vw-3rem)] max-w-[700px]">

              <div className="flex max-h-[min(720px,calc(100vh-3rem))] flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">

                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2 font-semibold text-slate-900">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    AI Portfolio Analyst
                  </div>

                  <div className="ml-auto flex items-center gap-3">
                  <button
                      onClick={() => handleAnalyzeWithAI(true)}
                      disabled={aiLoading}
                      className="text-xs rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {aiLoading ? "Running..." : "Re-run"}
                  </button>

                  {aiLoading && (
                      <div className="h-3 w-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                  )}

                  <button
                      onClick={() => setAiPanelOpen(false)}
                      className="text-slate-500 hover:text-slate-900"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
                <div className="min-h-0 overflow-y-auto border-b border-slate-200 p-4 text-xs text-slate-700 whitespace-pre-wrap md:border-b-0 md:border-r">

                  <ReactMarkdown
                      components={{
                        h2: ({ children }) => (
                            <h2 className="text-sm font-semibold text-slate-900">{children}</h2>
                        ),
                        h3: ({ children }) => (
                            <h3 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">{children}</h3>
                        ),
                        p: ({ children }) => <p className="mb-2">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
                        li: ({ children }) => <li>{children}</li>,
                      }}
                  >
                    {aiLoading
                        ? "Analyzing dashboard..."
                        : cleanedInsights ?? "Run analysis to generate insights."}
                  </ReactMarkdown>

                  {aiError ? (
                      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                        {aiError}
                      </div>
                  ) : null}
                </div>

                {(strategicActions.length > 0 || quickActions.length > 0) && (
                    <div className="min-h-0 overflow-y-auto bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/85">
                      {strategicActions.length > 0 ? (
                          <div>
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Strategic Actions
                            </div>
                            <div className="space-y-2">
                              {strategicActions.map((action) => {
                                const actionKey = getAIActionKey(action);
                                const isRunning = aiExecutingAction === actionKey;
                                const buySummary = formatTradeSymbolSummary(action.rebalance_plan.trades, "buy");
                                const sellSummary = formatTradeSymbolSummary(action.rebalance_plan.trades, "sell");
                                const tradeSummary = [buySummary, sellSummary].filter(Boolean).join(" · ");
                                return (
                                    <button
                                        key={actionKey}
                                        onClick={() => handleStrategicAction(action)}
                                        disabled={isRunning}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:bg-slate-100 disabled:opacity-60"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="text-xs font-semibold text-slate-900">{action.label}</div>

                                      </div>
                                      <div
                                        className="mt-1 text-[11px] text-slate-500"
                                        title={tradeSummary || undefined}
                                      >
                                        {action.rebalance_plan.trade_count} trades · {fmtMoney(action.rebalance_plan.buy_value)} buy · {fmtMoney(action.rebalance_plan.sell_value)} sell
                                      </div>
                                    </button>
                                );
                              })}
                            </div>
                          </div>
                      ) : null}

                      {quickActions.length > 0 ? (
                          <div className={strategicActions.length > 0 ? "mt-4" : ""}>
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Quick Actions
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {quickActions.map((action) => {
                                const actionKey = getAIActionKey(action);
                                const isRunning = aiExecutingAction === actionKey;
                                return (
                                    <button
                                        key={actionKey}
                                        onClick={() => handleQuickAction(action)}
                                        disabled={isRunning}
                                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                                    >
                                      {action.label}
                                    </button>
                                );
                              })}
                            </div>
                          </div>
                      ) : null}
                    </div>
                )}
                </div>

              </div>

            </div>
        )}

      </div>
  );
}
