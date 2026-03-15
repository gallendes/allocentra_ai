import type { RebalancePlan } from "@/lib/ai/contracts";

type ExecuteRebalancePlanOptions = {
    username: string;
    executedAt?: string;
    fetchImpl?: typeof fetch;
};

type ExecuteRebalancePlanResult = {
    executed: number;
};

function localDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export async function executeRebalancePlan(
    plan: RebalancePlan,
    options: ExecuteRebalancePlanOptions
): Promise<ExecuteRebalancePlanResult> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const executedAt = options.executedAt ?? localDateISO();

    for (const trade of plan.trades) {
        const response = await fetchImpl("/api/trade", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                username: options.username,
                symbol: trade.symbol,
                type: trade.side === "buy" ? "BUY" : "SELL",
                executed_at: executedAt,
                shares: trade.shares,
                price: trade.price,
            }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || `api/trade failed: ${response.status}`);
        }
    }

    return {
        executed: plan.trades.length,
    };
}
