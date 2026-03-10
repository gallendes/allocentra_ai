// scripts/backfill.ts
//
// One-off backfill for daily closes into Neon Postgres.
// Example:
//   TWELVE_DATA_API_KEY=xxx DATABASE_URL=postgres://... \
//   npx tsx scripts/backfill.ts AAPL 2025-02-23 2026-02-23 "Apple Inc."
//
// Notes:
// - Uses Twelve Data time_series (daily) and inserts into:
//   - symbols(symbol, name)
//   - time_series(symbol, datetime, close)
// - Idempotent via ON CONFLICT (symbol, datetime) DO UPDATE

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

type TwelveTimeSeriesResponse = {
    status?: string;
    message?: string;
    meta?: {
        symbol?: string;
        interval?: string;
        currency?: string;
        exchange_timezone?: string;
    };
    values?: Array<{
        datetime: string; // e.g. "2025-02-24" or "2025-02-24 00:00:00"
        close: string;
    }>;
};

function mustEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env var: ${name}`);
    return v;
}

function toIsoTimestamptz(dt: string): string {
    // Twelve Data daily often returns "YYYY-MM-DD".
    // Store as UTC midnight for consistency.
    // If it already includes time, normalize to ISO.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) return `${dt}T00:00:00.000Z`;
    // "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ssZ"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dt)) {
        return dt.replace(" ", "T") + "Z";
    }
    // Fallback: let Postgres parse it; still return string
    return dt;
}

async function fetchDailyTimeSeries(
    symbol: string,
    start: string,
    end: string
): Promise<TwelveTimeSeriesResponse> {
    const apikey = mustEnv("TWELVE_DATA_API_KEY");

    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1day");
    url.searchParams.set("start_date", start);
    url.searchParams.set("end_date", end);
    url.searchParams.set("apikey", apikey);
    // optional, helps keep decimals stable
    url.searchParams.set("dp", "6");

    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as TwelveTimeSeriesResponse;

    if (!res.ok || json.status === "error") {
        throw new Error(
            `Twelve Data error: ${res.status} ${json.message ?? "unknown"}`
        );
    }

    return json;
}

async function main() {
    const symbol = (process.argv[2] ?? "").toUpperCase();
    const start = process.argv[3] ?? "";
    const end = process.argv[4] ?? "";
    const name = process.argv[5] ?? symbol;

    if (!symbol || !start || !end) {
        console.error(
            `Usage: npx tsx src/scripts/backfill.ts <SYMBOL> <YYYY-MM-DD> <YYYY-MM-DD> [NAME]`
        );
        process.exit(1);
    }

    const sql = neon(mustEnv("DATABASE_URL"));

    const resp = await fetchDailyTimeSeries(symbol, start, end);
    const values = resp.values ?? [];

    if (!values.length) {
        console.log(`No values returned for ${symbol} in ${start}..${end}`);
        return;
    }

    // Twelve Data often returns newest-first; we don’t care, but sorting helps debugging.
    values.sort((a, b) => a.datetime.localeCompare(b.datetime));

    // 1) Ensure symbol exists
    await sql`
    INSERT INTO symbols (symbol, name)
    VALUES (${symbol}, ${name})
    ON CONFLICT (symbol) DO UPDATE
    SET name = EXCLUDED.name
  `;

    // 2) Bulk insert into time_series (single year daily => small)
    const rows = values.map((v) => ({
        symbol,
        datetime: toIsoTimestamptz(v.datetime),
        close: Number(v.close),
    }));

    // Build a single INSERT ... VALUES ... statement safely
    // neon tagged template supports interpolating arrays of tuples like this:
    const tuples = rows.map((r) => [r.symbol, r.datetime, r.close]);

    await sql`
    INSERT INTO time_series (symbol, datetime, close)
    SELECT * FROM UNNEST(
      ${tuples.map((t) => t[0])}::text[],
      ${tuples.map((t) => t[1])}::timestamptz[],
      ${tuples.map((t) => t[2])}::numeric[]
    )
    ON CONFLICT (symbol, datetime) DO UPDATE
    SET close = EXCLUDED.close
  `;

    console.log(
        `Backfilled ${rows.length} daily rows for ${symbol} (${start}..${end})`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});