import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

const sql = neon(process.env.DATABASE_URL!);

function bad(message: string, status = 400) {
    return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);

        const symbol = searchParams.get("symbol");
        const date = searchParams.get("date");

        if (!symbol) return bad("Missing symbol");
        if (!date) return bad("Missing date");

        const rows = await sql`
            SELECT close
            FROM time_series
            WHERE symbol = ${symbol}
              AND datetime <= ${date}::date + interval '1 day'
            ORDER BY datetime DESC
                LIMIT 1
        `;

        if (rows.length === 0) {
            return bad("Price not found for that date", 404);
        }

        return NextResponse.json({
            symbol,
            date,
            price: Number(rows[0].close),
        });

    } catch (err) {
        console.error("price-at-date error:", err);
        return bad("Internal server error", 500);
    }
}