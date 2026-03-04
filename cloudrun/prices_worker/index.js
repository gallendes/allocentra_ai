// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const TWELVE_BASE = "https://api.twelvedata.com";

process.on("unhandledRejection", (err) => {
    console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

async function getSymbols(client) {
    const { rows } = await client.query(`
    SELECT symbol
    FROM symbols
    ORDER BY symbol ASC
  `);
    return rows.map((r) => r.symbol);
}

async function fetchPricesFromTwelveData(symbols) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) throw new Error("Missing TWELVEDATA_API_KEY");

    const url =
        `${TWELVE_BASE}/price` +
        `?symbol=${encodeURIComponent(symbols.join(","))}` +
        `&apikey=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url);
    const json = await r.json();

    if (!r.ok || json?.status === "error") {
        throw new Error(
            `TwelveData price failed: ${json?.message || r.statusText}`
        );
    }

    const prices = new Map();

    // single symbol response
    if (symbols.length === 1 && typeof json?.price === "string") {
        const n = Number(json.price);
        if (Number.isFinite(n)) prices.set(symbols[0], n);
        return prices;
    }

    // multi-symbol response
    for (const sym of symbols) {
        const n = Number(json?.[sym]?.price);
        if (Number.isFinite(n)) prices.set(sym, n);
    }

    return prices;
}

async function upsertLatestPrices(client, prices) {
    const entries = Array.from(prices.entries());

    for (const [symbol, latest_price] of entries) {
        await client.query(
            `
              INSERT INTO latest_prices (symbol, latest_price, updated_at)
              VALUES ($1, $2, NOW())
              ON CONFLICT (symbol)
              DO UPDATE SET
                latest_price = EXCLUDED.latest_price,
                updated_at = NOW()
      `,
            [symbol, latest_price]
        );
    }
}

async function runGetPrices() {
    const client = await pool.connect();

    try {
        const symbols = await getSymbols(client);

        if (!symbols.length) {
            return [];
        }

        const prices = await fetchPricesFromTwelveData(symbols);

        await upsertLatestPrices(client, prices);

        return Array.from(prices.entries()).map(([symbol, price]) => ({
            symbol,
            price,
        }));
    } finally {
        client.release();
    }
}

async function fetchEodBatch(symbols) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) throw new Error("Missing TWELVEDATA_API_KEY");

    const url =
        `https://api.twelvedata.com/eod` +
        `?symbol=${encodeURIComponent(symbols.join(","))}` +
        `&apikey=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url);
    const json = await r.json();

    if (!r.ok || json?.status === "error") {
        throw new Error(
            `TwelveData EOD error: ${json?.message || r.statusText}`
        );
    }

    const results = [];

    for (const sym of symbols) {
        const row = json?.[sym];
        if (!row) continue;

        const close = Number(row.close);
        const date = row.datetime;

        if (!Number.isFinite(close) || !date) continue;

        results.push({
            symbol: sym,
            date,
            close,
        });
    }

    return results;
}

async function runBackfill() {
    const client = await pool.connect();

    try {
        const symbols = await getSymbols(client);
        const results = [];

        const candles = await fetchEodBatch(symbols);

        for (const { symbol, date, close } of candles) {
            const datetimeUtc = new Date(`${date}T00:00:00Z`);

            await client.query(
                `
                INSERT INTO time_series(symbol, datetime, close)
                VALUES ($1, $2, $3)
                ON CONFLICT (symbol, datetime)
                DO UPDATE SET close = EXCLUDED.close
                `,
                [symbol, datetimeUtc.toISOString(), close]
            );

            results.push({ symbol, date, close });
        }

        return results;
    } finally {
        client.release();
    }
}

exports.main = async (req, res) => {
    try {
        console.log("PATH:", req.path, "METHOD:", req.method);

        if (req.path === "/get-prices") {
            const results = await runGetPrices();
            return res.json({
                ok: true,
                updated: results.length,
                data: results,
            });
        }

        if (req.path === "/backfill") {
            const results = await runBackfill();
            return res.json({
                ok: true,
                inserted: results.length,
                data: results,
            });
        }

        return res.status(404).json({ ok: false, error: "Not found" });
    } catch (err) {
        console.error("HANDLER ERROR:", err);

        return res.status(500).json({
            ok: false,
            error: err?.message || String(err),
        });
    }
};