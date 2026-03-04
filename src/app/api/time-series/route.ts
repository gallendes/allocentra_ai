// src/app/api/time_series/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const sql = neon(process.env.DATABASE_URL!);

function subDays(d: Date, days: number) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() - days);
    return x;
}
function subMonths(d: Date, months: number) {
    const x = new Date(d.getTime());
    x.setMonth(x.getMonth() - months);
    return x;
}
function subYears(d: Date, years: number) {
    const x = new Date(d.getTime());
    x.setFullYear(x.getFullYear() - years);
    return x;
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const username = searchParams.get("username") ?? "sea_otter";
        const timeframe = searchParams.get("timeframe") ?? "1m";

        // 🔹 Get NY market date directly from Postgres
        const [{ market_date }] = await sql`
            SELECT (NOW() AT TIME ZONE 'America/New_York')::DATE AS market_date
          `;

        const toDate = new Date(market_date);
        const to = market_date;

        let fromDate: Date;
        switch (timeframe) {
            case "1d":
                fromDate = subDays(toDate, 1);
                break;
            case "5d":
                fromDate = subDays(toDate, 5);
                break;
            case "1m":
                fromDate = subMonths(toDate, 1);
                break;
            case "6m":
                fromDate = subMonths(toDate, 6);
                break;
            case "1y":
                fromDate = subYears(toDate, 1);
                break;
            case "5y":
                fromDate = subYears(toDate, 5);
                break;
            default:
                fromDate = subMonths(toDate, 1);
        }

        const from = fromDate.toISOString().slice(0, 10);

        if (timeframe === "1d") {

            const r = await fetch(
                `${process.env.NEXT_PUBLIC_BASE_URL}/api/portfolio?username=${username}`,
                { cache: "no-store" }
            );

            const p = await r.json();

            const yesterday_value = p.total_value - p.total_day_gain;
            const today_value = p.total_value;

            return NextResponse.json({
                from,
                to,
                range_pnl: p.total_day_gain,
                range_pnl_percent: p.total_day_gain_percent,
                history: [
                    { datetime: from, portfolio_value: yesterday_value },
                    { datetime: to, portfolio_value: today_value }
                ]
            });
        }

        const rows = await sql`
            WITH relevant_symbols AS (
              SELECT DISTINCT symbol
              FROM trades
              WHERE username = ${username}
            ),
            closes AS (
              SELECT
                ts.symbol,
                ts.datetime::DATE AS dt,
                ts.close
              FROM time_series ts
              JOIN relevant_symbols rs
                ON rs.symbol = ts.symbol
              WHERE ts.datetime::DATE BETWEEN ${from}::DATE AND ${to}::DATE
            ),
            trade_daily AS (
              SELECT
                t.symbol,
                t.executed_at::DATE AS dt,
                SUM(
                  CASE
                    WHEN t.type = 'BUY' THEN t.shares
                    ELSE -t.shares
                  END
                ) AS delta
              FROM trades t
              WHERE t.username = ${username}
                AND t.executed_at::DATE <= ${to}::DATE
              GROUP BY t.symbol, t.executed_at::DATE
            ),
            opening AS (
              SELECT
                symbol,
                COALESCE(SUM(delta), 0) AS opening_shares
              FROM trade_daily
              WHERE dt < ${from}::DATE
              GROUP BY symbol
            ),
            closes_with_delta AS (
              SELECT
                c.symbol,
                c.dt,
                c.close,
                COALESCE(td.delta, 0) AS delta,
                COALESCE(o.opening_shares, 0) AS opening_shares
              FROM closes c
              LEFT JOIN trade_daily td
                ON td.symbol = c.symbol
               AND td.dt = c.dt
              LEFT JOIN opening o
                ON o.symbol = c.symbol
            ),
            holdings AS (
              SELECT
                symbol,
                dt,
                close,
                (
                  opening_shares
                  + SUM(delta) OVER (
                      PARTITION BY symbol
                      ORDER BY dt
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    )
                ) AS shares
              FROM closes_with_delta
            ),
            current_holdings AS (
                SELECT
                    h.symbol,
                    MAX(h.shares) AS shares
                FROM holdings h
                GROUP BY h.symbol
            ),
            today_value AS (
                SELECT
                    ${to}::DATE AS dt,
                    ROUND(SUM(ch.shares * lp.latest_price)::NUMERIC, 2) AS portfolio_value
                FROM current_holdings ch
                    JOIN latest_prices lp
                ON lp.symbol = ch.symbol
                WHERE ${to}::DATE > (SELECT MAX(dt) FROM holdings)
            )
            SELECT
                dt AS datetime,
                portfolio_value
            FROM (
                 SELECT
                     dt,
                     ROUND(SUM(shares * close)::NUMERIC, 2) AS portfolio_value
                 FROM holdings
                 GROUP BY dt

                 UNION ALL

                 SELECT dt, portfolio_value
                 FROM today_value
             ) x
            GROUP BY dt, portfolio_value
            ORDER BY dt DESC;
          `;

        const history = rows.map((r: any) => ({
            datetime: String(r.datetime),
            portfolio_value: Number(r.portfolio_value),
        }));

        if (history.length === 0) {
            return NextResponse.json({
                from,
                to,
                range_pnl: 0,
                range_pnl_percent: 0,
                history: [],
            });
        }

        const newest = history[0].portfolio_value;
        const oldest = history[history.length - 1].portfolio_value;

        const range_pnl = Number((newest - oldest));
        const range_pnl_percent =
            oldest !== 0
                ? Number(((range_pnl / oldest)))
                : 0;

        return NextResponse.json({
            from,
            to,
            range_pnl,
            range_pnl_percent,
            history,
        });
    } catch (err) {
        console.error("GET /api/time_series failed:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}