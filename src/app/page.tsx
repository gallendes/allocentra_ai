"use client";

import { useEffect, useMemo, useState } from "react";

type Position = {
  symbol: string;
  amount: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  allocation_percent: number;
};

type PortfolioResponse = {
  total_value: number;
  total_unrealized_pnl: number;
  positions: Position[];
  error?: string;
};

const SYMBOL_NAMES: Record<string, string> = {
  AMZN: "Amazon.com Inc",
  AAPL: "Apple Inc",
  MSFT: "Microsoft Corp",
  NVDA: "NVIDIA Corp",
  TSLA: "Tesla Inc",
};

const PIE_COLORS = ["#4C9BD9", "#EA832D", "#A9A9A9", "#F2B602", "#4773C1"];

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function toPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function buildHistory(total: number, points = 55) {
  const output: number[] = [];
  let base = Math.max(total * 0.8, 1000);
  for (let i = 0; i < points; i += 1) {
    const wave = Math.sin(i / 4) * 38 + Math.sin(i / 10) * 22;
    const drift = i < points * 0.6 ? i * 7 : (points - i) * 3;
    const noise = ((i * 73) % 17) - 8;
    base = Math.max(950, base + wave * 0.15 + drift * 0.08 + noise);
    output.push(base);
  }
  output[output.length - 1] = total;
  return output;
}

function toPath(values: number[], width: number, height: number, topPad = 8) {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const yRange = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = topPad + ((max - value) / yRange) * (height - topPad - 16);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function slicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

export default function Home() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const username = query.get("username") ?? "sea_otter";

    fetch(`/api/portfolio?username=${encodeURIComponent(username)}`)
      .then((res) => res.json())
      .then((data: PortfolioResponse) => {
        if (data?.error) {
          setError(data.error);
          return;
        }
        setPortfolio(data);
      })
      .catch(() => setError("Failed to load portfolio"));
  }, []);

  const positions = useMemo(() => portfolio?.positions ?? [], [portfolio]);
  const history = useMemo(() => buildHistory(portfolio?.total_value ?? 1400), [portfolio?.total_value]);
  const linePath = useMemo(() => toPath(history, 680, 270), [history]);

  const pieSlices = useMemo(
    () =>
      positions.map((p, i) => {
        const start = positions.slice(0, i).reduce((sum, current) => sum + (current.allocation_percent / 100) * 360, 0);
        const end = start + (p.allocation_percent / 100) * 360;
        return {
          symbol: p.symbol,
          percent: p.allocation_percent,
          color: PIE_COLORS[i % PIE_COLORS.length],
          path: slicePath(110, 112, 78, start, end),
        };
      }),
    [positions]
  );

  return (
    <div className="min-h-screen bg-[#F3F3F3] px-6 py-10 text-[#1F1F1F]">
      <main className="mx-auto max-w-[1220px]">
        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}

        {!portfolio ? (
          <div className="rounded-md border border-[#D6D6D6] bg-white p-5 text-[#6B7280]">Loading portfolio...</div>
        ) : (
          <>
            <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
              <div className="rounded-sm border border-[#D5D5D5] bg-white p-5">
                <div className="flex items-start gap-3">
                  <h1 className="text-[44px] leading-none font-semibold">{toCurrency(portfolio.total_value)}</h1>
                  <span className="rounded-sm bg-[#DDF4DE] px-2 py-1 text-[16px] font-semibold text-[#2E8B57]">
                    {toPercent((portfolio.total_unrealized_pnl / Math.max(portfolio.total_value - portfolio.total_unrealized_pnl, 1)) * 100)}
                  </span>
                  <span className="pt-1 text-[18px] font-semibold text-[#2E8B57]">
                    {portfolio.total_unrealized_pnl >= 0 ? "+" : ""}
                    {toCurrency(portfolio.total_unrealized_pnl)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-[#6C7280]">Feb 23, 3:01:52PM UTC-3 · USD · Disclaimer</p>

                <div className="mt-3 flex items-center gap-6 text-sm font-semibold text-[#6C7280]">
                  {["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"].map((item) => (
                    <button
                      key={item}
                      className={item === "1Y" ? "border-b-2 border-[#3A82F7] pb-[2px] text-[#3A82F7]" : ""}
                      type="button"
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <div className="mt-3 overflow-hidden rounded-sm border border-[#E0E0E0]">
                  <svg viewBox="0 0 680 270" className="h-auto w-full bg-white">
                    <defs>
                      <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6EA3FF" stopOpacity="0.32" />
                        <stop offset="100%" stopColor="#6EA3FF" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>
                    {[0, 1, 2, 3].map((n) => (
                      <line
                        key={n}
                        x1="0"
                        y1={20 + n * 62}
                        x2="680"
                        y2={20 + n * 62}
                        stroke="#E6E8ED"
                        strokeWidth="1"
                      />
                    ))}
                    <path d={`${linePath} L 680 260 L 0 260 Z`} fill="url(#lineFill)" />
                    <path d={linePath} fill="none" stroke="#3A82F7" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </div>
              </div>

              <aside className="rounded-sm border border-[#D5D5D5] bg-white p-5">
                <h2 className="text-center text-[32px] leading-none font-semibold text-[#6B6B6B]">Portfolio Distribution</h2>
                <div className="mt-4 flex justify-center">
                  <svg viewBox="0 0 220 220" className="h-[220px] w-[220px]">
                    {pieSlices.map((slice) => (
                      <path key={slice.symbol} d={slice.path} fill={slice.color} stroke="#FFFFFF" strokeWidth="2" />
                    ))}
                  </svg>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-4 text-xs text-[#5E636E]">
                  {pieSlices.map((slice) => (
                    <div key={slice.symbol} className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2" style={{ backgroundColor: slice.color }} />
                      <span>{slice.symbol}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </section>

            <section className="mt-8 overflow-x-auto rounded-sm border border-[#D5D5D5] bg-white">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-[#F7F7F7] text-[23px] uppercase text-[#202020]">
                  <tr>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Symbol</th>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Name</th>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Price</th>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Quantity</th>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Gain</th>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Day Gain</th>
                    <th className="border-b border-r border-[#D5D5D5] px-4 py-3 text-center">Value</th>
                    <th className="border-b border-[#D5D5D5] px-4 py-3 text-center"> </th>
                  </tr>
                </thead>
                <tbody className="text-[30px] text-[#2A2A2A]">
                  {positions.map((position) => {
                    const gainPct = (position.unrealized_pnl / Math.max(position.market_value - position.unrealized_pnl, 1)) * 100;
                    return (
                      <tr key={position.symbol} className="border-b border-[#D5D5D5] last:border-b-0">
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">{position.symbol}</td>
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">
                          {SYMBOL_NAMES[position.symbol] ?? position.symbol}
                        </td>
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">{toCurrency(position.current_price)}</td>
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">{position.amount}</td>
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">
                          {position.unrealized_pnl >= 0 ? "+" : ""}
                          {toCurrency(position.unrealized_pnl)}
                        </td>
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">{toPercent(gainPct)}</td>
                        <td className="border-r border-[#D5D5D5] px-4 py-3 text-center">{toCurrency(position.market_value)}</td>
                        <td className="px-4 py-3 text-center text-2xl text-[#303030]">⌄</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
