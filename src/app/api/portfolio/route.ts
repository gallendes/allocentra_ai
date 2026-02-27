// src/app/api/portfolio/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const sql = neon(process.env.DATABASE_URL!);

function num(x: any): number {
    const n = typeof x === "string" ? Number(x) : x;
    return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username") ?? "sea_otter";

    // Pull everything we need in one query:
    // - shares: buys - sells
    // - net_purchases: buys(cost) - sells(proceeds) using trade.price
    // - current_price: latest_prices.latest_price
    // - yesterday_close: from time_series (latest row not equal to today if exists)
    const rows = await sql`
        WITH trade_agg AS (
          SELECT
            t.symbol,
            SUM(CASE WHEN t.type = 'BUY' THEN t.shares ELSE -t.shares END) AS shares,
            SUM(CASE WHEN t.type = 'BUY' THEN t.shares * t.price ELSE -(t.shares * t.price) END) AS net_purchases
          FROM trades t
          WHERE t.username = ${username}
          GROUP BY t.symbol
        ),
        last_two AS (
          SELECT
            ts.symbol,
            ts.datetime::date AS dt,
            ts.close,
            ROW_NUMBER() OVER (PARTITION BY ts.symbol ORDER BY ts.datetime::date DESC) AS rn
          FROM time_series ts
          WHERE ts.symbol IN (SELECT symbol FROM trade_agg)
        ),
        prev_close AS (
          SELECT
            symbol,
            MAX(CASE WHEN rn = 1 THEN dt END) AS dt1,
            MAX(CASE WHEN rn = 1 THEN close END) AS close1,
            MAX(CASE WHEN rn = 2 THEN close END) AS close2
          FROM last_two
          WHERE rn <= 2
          GROUP BY symbol
        ),
        volatility AS (
          SELECT
            symbol,
            STDDEV(ret) * SQRT(252) AS volatility
          FROM (
             SELECT
               ts.symbol,
               (ts.close / LAG(ts.close) OVER (PARTITION BY ts.symbol ORDER BY ts.datetime) - 1) AS ret
             FROM time_series ts
             WHERE ts.datetime >= NOW() - INTERVAL '1 year'
               AND ts.symbol IN (SELECT symbol FROM trade_agg)
          ) r
          WHERE ret IS NOT NULL
          GROUP BY symbol
        )
        SELECT
          a.symbol,
          s.name,
          a.shares,
          a.net_purchases,
          lp.latest_price AS current_price,
          s.industry_sector,
          s.company_size,
          v.volatility,
          CASE
            WHEN prev.dt1 = (NOW() AT TIME ZONE 'utc')::date THEN prev.close2
            ELSE prev.close1
          END AS yesterday_close
        FROM trade_agg a
        JOIN latest_prices lp ON lp.symbol = a.symbol
        JOIN symbols s ON s.symbol = a.symbol
        LEFT JOIN prev_close prev ON prev.symbol = a.symbol
        LEFT JOIN vol_calc v ON v.symbol = a.symbol
        WHERE a.shares <> 0
        ORDER BY a.symbol ASC
      `;

    // Build positions
    const positions = (rows as any[]).map((r) => {
        const shares = num(r.shares);
        const name= String(r.name);
        const industry_sector = String(r.industry_sector);
        const company_size = String(r.company_size);
        const current_price = num(r.current_price);
        const net_purchases = num(r.net_purchases);
        const yesterday_close = num(r.yesterday_close);
        const volatility = num(r.volatility);

        const value = shares * current_price;

        const pnl = value - net_purchases;
        const pnl_percent =
            net_purchases !== 0 ? value / net_purchases - 1 : 0;

        const day_gain = shares * (current_price - yesterday_close);
        const day_gain_percent =
            yesterday_close !== 0 ? current_price / yesterday_close - 1 : 0;

        return {
            symbol: r.symbol,
            name,
            shares,
            industry_sector,
            company_size,
            current_price,
            value,
            pnl,
            pnl_percent,
            day_gain,
            day_gain_percent,
            volatility,
            allocation_percent: 0, // fill after total_value
        };
    });

    // Totals (per your contract)
    const total_value = positions.reduce((s, p) => s + p.value, 0);
    const total_pnl = positions.reduce((s, p) => s + p.pnl, 0);
    const total_day_gain = positions.reduce((s, p) => s + p.day_gain, 0);

    // allocation_percent
    for (const p of positions) {
        p.allocation_percent = total_value !== 0 ? p.value / total_value : 0;
    }

    // total_*_percent (per your exact formulas)
    // total_pnl / (total_value - total_pnl) == total_pnl / total_net_purchases
    const total_pnl_percent =
        (total_value - total_pnl) !== 0 ? total_pnl / (total_value - total_pnl) : 0;

    // total_day_gain / (total_value - total_day_gain) == total_day_gain / total_prev_value
    const total_day_gain_percent =
        (total_value - total_day_gain) !== 0
            ? total_day_gain / (total_value - total_day_gain)
            : 0;

    // helper for industry_allocations and size_allocations
    function round2(n: number) {
        return Math.round(n * 100) / 100;
    }

    // industry_allocations
    const industry_allocations: Record<string, number> = {};

    const sectorTotals: Record<string, number> = {};
    for (const p of positions) {
        const sector = String(p.industry_sector ?? "unknown").toLowerCase();
        sectorTotals[sector] = (sectorTotals[sector] ?? 0) + p.value;
    }

    for (const [sector, value] of Object.entries(sectorTotals)) {
        industry_allocations[sector] =
            total_value !== 0 ? round2((value / total_value) * 100) : 0;
    }

    // size_allocations
    const size_allocations: Record<string, number> = {};

    const sizeTotals: Record<string, number> = {};
    for (const p of positions) {
        const size = String(p.company_size ?? "unknown").toLowerCase();
        sizeTotals[size] = (sizeTotals[size] ?? 0) + p.value;
    }

    for (const[size, value] of Object.entries(sizeTotals)) {
        size_allocations[size] =
            total_value !== 0 ? round2((value / total_value) * 100) : 0;
    }

    return NextResponse.json({
        total_value,
        total_pnl,
        total_pnl_percent,
        total_day_gain,
        total_day_gain_percent,
        industry_allocations,
        size_allocations,
        positions: positions.sort((a, b) => b.value - a.value),
    });
}
