import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

/**
 * GET /api/positions?username=gonzalo
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const username = searchParams.get("username")

    if (!username) {
        return NextResponse.json(
            { error: "username is required" },
            { status: 400 }
        )
    }

    try {
        const rows = await sql`
          SELECT symbol, amount, avg_cost
          FROM positions
          WHERE username = ${username}
          ORDER BY symbol;
        `

        return NextResponse.json({ positions: rows })
    } catch (err) {
        return NextResponse.json(
            { error: "Failed to fetch positions" },
            { status: 500 }
        )
    }
}
