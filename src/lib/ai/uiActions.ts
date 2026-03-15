import type { Dispatch, SetStateAction } from "react";

import type { QuickAction } from "@/lib/ai/contracts";

type Timeframe = "1d" | "5d" | "1m" | "6m" | "1y" | "5y";

type PerformQuickActionContext = {
    setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
    ensureTrades: (symbol: string) => Promise<void>;
    setTimeframe: Dispatch<SetStateAction<Timeframe>>;
    flashIndustry: (industry: string) => void;
    flashCompanySize: (companySize: string) => void;
};

function normalizeTimeframe(timeframe?: string): Timeframe | null {
    const normalized = timeframe?.trim().toLowerCase();
    switch (normalized) {
        case "1d":
        case "5d":
        case "1m":
        case "6m":
        case "1y":
        case "5y":
            return normalized;
        default:
            return null;
    }
}

export async function performQuickAction(
    action: QuickAction,
    context: PerformQuickActionContext
) {
    switch (action.action) {
        case "open_ledger":
            if (!action.symbol) {
                return;
            }

            {
                const symbol = action.symbol;
                context.setExpanded((current) => ({ ...current, [symbol]: true }));
                await context.ensureTrades(symbol);
            }
            return;

        case "analyze_timeframe": {
            const timeframe = normalizeTimeframe(action.timeframe);
            if (timeframe) {
                context.setTimeframe(timeframe);
            }
            return;
        }

        case "highlight_industry":
            if (action.industry) {
                context.flashIndustry(action.industry);
            }
            return;

        case "highlight_size":
            if (action.company_size) {
                context.flashCompanySize(action.company_size);
            }
            return;
    }
}
