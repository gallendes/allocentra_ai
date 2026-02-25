// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function fetchClose(symbol) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) throw new Error("Missing TWELVEDATA_API_KEY");

    const url =
        `https://api.twelvedata.com/time_series` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&interval=1day` +
        `&outputsize=1` +
        `&apikey=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url);
    const json = await r.json();

    if (!r.ok || json.status === "error") {
        throw new Error(
            `TwelveData error for ${symbol}: ${json.message || r.statusText}`
        );
    }

    const candle = json.values?.[0];
    if (!candle) throw new Error(`No daily data for ${symbol}`);

    return {
        date: candle.datetime,
        close: Number(candle.close),
    };
}

async function getSymbols(client) {
    const { rows } = await client.query(`
        SELECT symbol
        FROM positions
        GROUP BY symbol
        ORDER BY SUM(amount) DESC
    `);
    return rows.map((r) => r.symbol);
}

async function runBackfill(res) {
    const client = await pool.connect();
    try {
        const symbols = await getSymbols(client);
        const results = [];

        for (const symbol of symbols) {
            const { date, close } = await fetchClose(symbol);
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

        res.json({ ok: true, inserted: results.length, data: results });
    } finally {
        client.release();
    }
}

async function runGetPrices(res) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) throw new Error("Missing NEXT_PUBLIC_BASE_URL");

    const r = await fetch(`${baseUrl}/api/prices`, {
        cache: "no-store",
    });

    const json = await r.json();

    if (!r.ok) {
        throw new Error(`Prices route failed: ${json?.error || r.statusText}`);
    }

    res.json({ ok: true, data: json });
}

/*
  SINGLE exported function
  Functions Framework binds to this target
*/
exports.main = async (req, res) => {
    try {
        if (req.path === "/backfill") {
            return await runBackfill(res);
        }

        if (req.path === "/get-prices") {
            return await runGetPrices(res);
        }

        res.status(404).json({ error: "Not found" });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.message,
        });
    }
};