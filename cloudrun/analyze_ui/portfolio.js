/* eslint-disable @typescript-eslint/no-require-imports */
const { neon } = require("@neondatabase/serverless");

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

function num(value) {
    const parsed = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

function toEnumKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

async function getPortfolioSnapshot(username = "sea_otter") {
    if (!process.env.DATABASE_URL) {
        throw new Error("Missing DATABASE_URL");
    }

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
        prev_close AS (
          SELECT
            ts.symbol,
            ts.close AS yesterday_close
          FROM time_series ts
          WHERE ts.symbol IN (SELECT symbol FROM trade_agg)
            AND ts.datetime::DATE = (
              SELECT MAX(t2.datetime::DATE)
              FROM time_series t2
              WHERE t2.symbol = ts.symbol
                AND t2.datetime::DATE < ((NOW() AT TIME ZONE 'America/New_York')::DATE)
            )
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
          s.symbol,
          s.name,
          a.shares,
          a.net_purchases,
          lp.latest_price AS current_price,
          s.industry_sector,
          s.company_size,
          v.volatility,
          prev.yesterday_close
        FROM symbols s
        LEFT JOIN trade_agg a ON a.symbol = s.symbol
        LEFT JOIN latest_prices lp ON lp.symbol = s.symbol
        LEFT JOIN prev_close prev ON prev.symbol = s.symbol
        LEFT JOIN volatility v ON v.symbol = s.symbol
        ORDER BY s.symbol ASC
    `;

    const positions = rows.map((row) => {
        const shares = num(row.shares);
        const currentPrice = num(row.current_price);
        const netPurchases = num(row.net_purchases);
        const yesterdayClose = num(row.yesterday_close);
        const value = shares * currentPrice;
        const pnl = value - netPurchases;
        const dayGain = shares * (currentPrice - yesterdayClose);

        return {
            symbol: String(row.symbol || ""),
            name: String(row.name || ""),
            shares,
            industry_sector: toEnumKey(row.industry_sector),
            company_size: toEnumKey(row.company_size),
            current_price: currentPrice,
            value,
            pnl,
            pnl_percent: netPurchases !== 0 ? value / netPurchases - 1 : 0,
            day_gain: dayGain,
            day_gain_percent: yesterdayClose !== 0 ? currentPrice / yesterdayClose - 1 : 0,
            volatility: num(row.volatility),
            allocation_percent: 0,
        };
    });

    const totalValue = positions.reduce((sum, position) => sum + position.value, 0);
    const totalPnl = positions.reduce((sum, position) => sum + position.pnl, 0);
    const totalDayGain = positions.reduce((sum, position) => sum + position.day_gain, 0);

    for (const position of positions) {
        position.allocation_percent = totalValue !== 0 ? position.value / totalValue : 0;
    }

    const industryAllocations = {};
    const sizeAllocations = {};
    const sectorTotals = {};
    const sizeTotals = {};

    for (const position of positions) {
        const sector = position.industry_sector || "unknown";
        const size = position.company_size || "unknown";

        sectorTotals[sector] = (sectorTotals[sector] || 0) + position.value;
        sizeTotals[size] = (sizeTotals[size] || 0) + position.value;
    }

    for (const [sector, value] of Object.entries(sectorTotals)) {
        industryAllocations[sector] = totalValue !== 0 ? round2((value / totalValue) * 100) : 0;
    }

    for (const [size, value] of Object.entries(sizeTotals)) {
        sizeAllocations[size] = totalValue !== 0 ? round2((value / totalValue) * 100) : 0;
    }

    return {
        total_value: totalValue,
        total_pnl: totalPnl,
        total_pnl_percent: totalValue - totalPnl !== 0 ? totalPnl / (totalValue - totalPnl) : 0,
        total_day_gain: totalDayGain,
        total_day_gain_percent:
            totalValue - totalDayGain !== 0 ? totalDayGain / (totalValue - totalDayGain) : 0,
        industry_allocations: industryAllocations,
        size_allocations: sizeAllocations,
        positions: positions.sort((a, b) => b.value - a.value),
    };
}

module.exports = {
    getPortfolioSnapshot,
};
