// src/app/api/trades/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username") ?? "sea_otter";

    const rows = await sql`
        SELECT id, username, symbol, type, executed_at, shares, price
        FROM trades
        WHERE username = ${username}
        ORDER BY executed_at DESC, id DESC
      `;

    return NextResponse.json(rows);
}