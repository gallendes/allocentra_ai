import { NextResponse } from "next/server"
import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

async function getLatestPrice(symbol: string) {
    const result = await sql`
        SELECT latest_price
        FROM latest_prices
        WHERE symbol = ${symbol};
      `

    if (result.length === 0) {
        throw new Error("Price not found for symbol")
    }

    return Number(result[0].latest_price)
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { username, symbol, shares, value } = body

        if (!username || !symbol) {
            return NextResponse.json(
                { error: "username and symbol required" },
                { status: 400 }
            )
        }

        if (!shares && !value) {
            return NextResponse.json(
                { error: "Either shares or value must be provided" },
                { status: 400 }
            )
        }

        const price = await getLatestPrice(symbol)
        const computedShares = shares ?? (value / price)

        if (computedShares <= 0) {
            return NextResponse.json(
                { error: "Invalid share amount" },
                { status: 400 }
            )
        }

        const existing = await sql`
          SELECT amount, avg_cost
          FROM positions
          WHERE username = ${username}
          AND symbol = ${symbol};
        `

        const queries = []

        if (existing.length === 0) {
            queries.push(sql`
        INSERT INTO positions (username, symbol, amount, avg_cost)
        VALUES (${username}, ${symbol}, ${computedShares}, ${price});
      `)
        } else {
            const oldAmount = Number(existing[0].amount)
            const oldAvg = Number(existing[0].avg_cost)

            const newAmount = oldAmount + computedShares
            const newAvg =
                (oldAmount * oldAvg + computedShares * price) /
                newAmount

            queries.push(sql`
                UPDATE positions
                SET amount = ${newAmount},
                    avg_cost = ${newAvg}
                WHERE username = ${username}
                AND symbol = ${symbol};
              `)
        }

        await sql.transaction(queries)

        return NextResponse.json({ success: true })
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        )
    }
}

export async function PATCH(req: Request) {
    try {
        const body = await req.json()
        const { username, symbol, shares, value } = body

        if (!username || !symbol) {
            return NextResponse.json(
                { error: "username and symbol required" },
                { status: 400 }
            )
        }

        if (!shares && !value) {
            return NextResponse.json(
                { error: "Either shares or value must be provided" },
                { status: 400 }
            )
        }

        const price = await getLatestPrice(symbol)

        const existing = await sql`
          SELECT amount
          FROM positions
          WHERE username = ${username}
          AND symbol = ${symbol};
        `

        if (existing.length === 0) {
            return NextResponse.json(
                { error: "Position not found" },
                { status: 404 }
            )
        }

        const currentAmount = Number(existing[0].amount)
        const computedShares = shares ?? (value / price)

        if (computedShares <= 0) {
            return NextResponse.json(
                { error: "Invalid share amount" },
                { status: 400 }
            )
        }

        if (computedShares > currentAmount) {
            return NextResponse.json(
                { error: "Cannot sell more than owned" },
                { status: 400 }
            )
        }

        const newAmount = currentAmount - computedShares
        const queries = []

        if (newAmount === 0) {
            queries.push(sql`
                DELETE FROM positions
                WHERE username = ${username}
                AND symbol = ${symbol};
              `)
        } else {
            queries.push(sql`
                UPDATE positions
                SET amount = ${newAmount}
                WHERE username = ${username}
                AND symbol = ${symbol};
              `)
        }

        await sql.transaction(queries)

        return NextResponse.json({ success: true })
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message },
            { status: 500 }
        )
    }
}