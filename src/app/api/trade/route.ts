// src/app/api/trade/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL!);

type TradeType = "BUY" | "SELL";

function bad(msg: string, status = 400) {
    return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: Request) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return bad("Invalid JSON");
    }

    const username: string = body.username ?? "sea_otter";
    const symbol: string = body.symbol;
    const type: TradeType = body.type;
    const executed_at: string = body.executed_at; // "YYYY-MM-DD"
    const shares = Number(body.shares);
    const price = Number(body.price);

    if (!symbol) return bad("Missing symbol");
    if (type !== "BUY" && type !== "SELL") return bad("type must be BUY or SELL");
    if (!executed_at) return bad("Missing executed_at (YYYY-MM-DD)");
    if (!Number.isFinite(shares) || shares <= 0) return bad("shares must be > 0");
    if (!Number.isFinite(price) || price < 0) return bad("price must be >= 0");

    // Optional: ensure the symbol exists (nice error instead of FK error)
    const sym = await sql`select 1 from symbols where symbol = ${symbol} limit 1`;
    if (sym.length === 0) return bad(`Unknown symbol: ${symbol}`);

    const inserted = await sql`
        INSERT INTO trades (username, symbol, type, executed_at, shares, price)
        VALUES (${username}, ${symbol}, ${type}, ${executed_at}, ${shares}, ${price})
        RETURNING id, username, symbol, type, executed_at, shares, price
      `;

    return NextResponse.json(inserted[0], { status: 201 });
}