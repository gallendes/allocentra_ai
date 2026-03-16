// src/app/api/trade/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL!);

type TradeType = "BUY" | "SELL";

function bad(msg: string, status = 400) {
    return NextResponse.json({ error: msg }, { status });
}

function normalizeDateOnly(value: unknown) {
    if (typeof value === "string") {
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
        return match ? match[1] : value;
    }

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    return value;
}

export async function POST(req: Request) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return bad("Invalid JSON");
    }

    try {
        const username: string = body.username ?? "sea_otter";
        const symbol: string = body.symbol;
        const type: TradeType = body.type;
        const executed_at: string = body.executed_at;
        const shares = Number(body.shares);
        const price = Number(body.price);

        if (!symbol) return bad("Missing symbol");
        if (type !== "BUY" && type !== "SELL") return bad("type must be BUY or SELL");
        if (!executed_at) return bad("Missing executed_at (YYYY-MM-DD)");
        if (!Number.isFinite(shares) || shares <= 0) return bad("shares must be > 0");
        if (!Number.isFinite(price) || price < 0) return bad("price must be >= 0");

        const sym = await sql`
            SELECT 1 FROM symbols WHERE symbol = ${symbol} LIMIT 1
        `;
        if (sym.length === 0) return bad(`Unknown symbol: ${symbol}`);

        const inserted = await sql`
            INSERT INTO trades (username, symbol, type, executed_at, shares, price)
            VALUES (${username}, ${symbol}, ${type}, ${executed_at}, ${shares}, ${price})
            RETURNING id, username, symbol, type, executed_at, shares, price
        `;

        return NextResponse.json(
            {
                ...inserted[0],
                executed_at: normalizeDateOnly(inserted[0].executed_at),
            },
            { status: 201 }
        );

    } catch (err) {
        console.error("POST /api/trade failed:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);

        const idParam = searchParams.get("id");
        const username = searchParams.get("username") ?? "sea_otter";
        const id = Number(idParam);

        if (!idParam) return bad("Missing id");
        if (!Number.isFinite(id) || id <= 0) return bad("id must be a positive number");

        const deleted = await sql`
            DELETE FROM trades
            WHERE id = ${id} AND username = ${username}
            RETURNING id, username, symbol, type, executed_at, shares, price
        `;

        if (deleted.length === 0) {
            return bad("Trade not found (or not owned by user)", 404);
        }

        return NextResponse.json(
            {
                ...deleted[0],
                executed_at: normalizeDateOnly(deleted[0].executed_at),
            },
            { status: 200 }
        );
    } catch (e: any) {
        return bad(e?.message ?? "Failed to delete trade", 500);
    }
}
