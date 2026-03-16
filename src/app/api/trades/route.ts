// src/app/api/trades/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL!);

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

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const username = searchParams.get("username") ?? "sea_otter";
        const symbol = searchParams.get("symbol");

        if (!symbol) {
            return NextResponse.json(
                { error: "Symbol parameter is required" },
                { status: 400 }
            );
        }

        const rows = await sql`
            SELECT id, username, symbol, type, executed_at, shares, price
            FROM trades
            WHERE username = ${username}
              AND symbol = ${symbol}
            ORDER BY executed_at DESC, id DESC
        `;

        const normalizedRows = rows.map((row) => ({
            ...row,
            executed_at: normalizeDateOnly(row.executed_at),
        }));

        return NextResponse.json(normalizedRows);

    } catch (err) {
        console.error("GET /api/trades failed:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
