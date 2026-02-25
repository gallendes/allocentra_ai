// src/app/api/prices/route.ts
import {neon} from "@neondatabase/serverless";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL!);

const TTL_SECONDS = 9 * 60; // 9 minutes
const TWELVE_BASE = "https://api.twelvedata.com";

function parseSymbolsParam(url: URL): string[] | null {
    const raw = url.searchParams.get("symbols");
    if (!raw) return null;
    const list = raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
}

async function getTrackedSymbols(requested: string[] | null) {
    if (requested?.length) return requested;

    const rows = await sql`
        SELECT symbol 
        FROM symbols 
        ORDER BY symbol ASC
    `;
    return rows.map((r) => r.symbol);
}

async function readLatestPrices(symbols: string[]) {

    const rows = await sql`
        SELECT 
            symbol,
            latest_price::text AS latest_price,
            updated_at::text AS updated_at
        FROM latest_prices
        WHERE symbol = ANY(${symbols})
    `;

    return new Map(
        rows.map((r) => [
            r.symbol,
            {
                symbol: r.symbol,
                latest_price: Number(r.latest_price),
                updated_at: r.updated_at,
            },
        ])
    );
}

function isFresh(updatedAtIso: string) {
    const updatedMs = Date.parse(updatedAtIso);
    if (!Number.isFinite(updatedMs)) return false;
    return Date.now() - updatedMs <= TTL_SECONDS * 1000;
}

async function fetchPricesFromTwelveData(symbols: string[]) {
    const apikey = process.env.TWELVE_DATA_API_KEY;
    if (!apikey) throw new Error("Missing TWELVE_DATA_API_KEY");

    const url = new URL(TWELVE_BASE + "/price");
    url.searchParams.set("symbol", symbols.join(",")); // comma-separated batch
    url.searchParams.set("apikey", apikey);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = await res.json();

    if (!res.ok || json?.status === "error") {
        throw new Error(`Twelve Data price failed: ${res.status} ${json?.message ?? ""}`);
    }

    const out = new Map<string, number>();

    // Single symbol shape: { price: "..." }
    if (symbols.length === 1 && typeof json?.price === "string") {
        const n = Number(json.price);
        if (Number.isFinite(n)) out.set(symbols[0], n);
        return out;
    }

    // Multi symbol shape: { AAPL: { price: "..." }, ... }
    for (const sym of symbols) {
        const n = Number(json?.[sym]?.price);
        if (Number.isFinite(n)) out.set(sym, n);
    }

    return out;
}

async function upsertLatestPrices(prices: Map<string, number>) {
    const entries = Array.from(prices.entries());
    if (!entries.length) return;

    // Insert/update row by row (5 symbols, so this is fine and simple)
    for (const [symbol, latest_price] of entries) {
        await sql`
          INSERT INTO latest_prices (symbol, latest_price, updated_at)
          VALUES (${symbol}, ${latest_price}, NOW())
          ON CONFLICT (symbol) DO UPDATE
          SET latest_price = EXCLUDED.latest_price,
              updated_at   = NOW()
    `;
    }
}

export async function GET(req: Request) {
    try {
        if (!process.env.DATABASE_URL) {
            return Response.json({ error: "Missing DATABASE_URL" }, { status: 500 });
        }

        const url = new URL(req.url);
        const requested = parseSymbolsParam(url);
        const symbols = await getTrackedSymbols(requested);

        if (!symbols.length) {
            return Response.json({ data: [] });
        }

        const cached = await readLatestPrices(symbols);

        // Determine which symbols are missing/stale
        const stale: string[] = [];
        for (const sym of symbols) {
            const row = cached.get(sym);
            if (!row) stale.push(sym);
            else if (!isFresh(row.updated_at)) stale.push(sym);
        }

        if (stale.length) {
            const freshPrices = await fetchPricesFromTwelveData(stale);
            await upsertLatestPrices(freshPrices);

            // Re-read to return canonical DB values
            const refreshed = await readLatestPrices(symbols);
            const data = symbols.map((sym) => refreshed.get(sym) ?? { symbol: sym, latest_price: null, updated_at: null });

            return Response.json({
                data,
                meta: { refreshed: stale, ttl_seconds: TTL_SECONDS },
            });
        }

        const data = symbols.map((sym) => cached.get(sym)!);
        return Response.json({
            data,
            meta: { refreshed: [], ttl_seconds: TTL_SECONDS },
        });
    } catch (err: any) {
        return Response.json(
            { error: "Failed to serve prices", detail: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}