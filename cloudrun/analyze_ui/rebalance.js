const ACTION_TYPES = new Set([
    "rebalance",
    "open_ledger",
    "analyze_timeframe",
    "highlight_industry",
    "highlight_size",
]);

const STRATEGIES = new Set([
    "equal_weight",
    "sell_industry",
    "buy_industry",
    "sell_company_size",
    "buy_company_size",
    "sell_volatile",
]);

const INDUSTRIES = new Set([
    "energy",
    "healthcare",
    "industrials",
    "communication_services",
    "information_technology",
    "consumer_staples",
]);

const COMPANY_SIZES = new Set([
    "small_cap",
    "mid_cap",
    "large_cap",
    "mega_cap",
]);

const TIMEFRAMES = new Set(["1D", "5D", "1M", "6M", "1Y", "5Y"]);
const QUICK_ACTION_ORDER = [
    "open_ledger",
    "analyze_timeframe",
    "highlight_industry",
    "highlight_size",
];

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeEnum(value, allowedValues) {
    const normalized = cleanString(value).toLowerCase();
    if (!normalized) {
        return undefined;
    }

    for (const candidate of allowedValues) {
        if (candidate.toLowerCase() === normalized) {
            return candidate;
        }
    }

    return undefined;
}

function normalizeTimeframe(value) {
    const normalized = cleanString(value).toUpperCase();
    return TIMEFRAMES.has(normalized) ? normalized : undefined;
}

function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function createTrade(position, side, rawShares) {
    const cappedShares =
        side === "sell"
            ? Math.min(position.shares, Math.max(rawShares, 0))
            : Math.max(rawShares, 0);
    const shares = round(cappedShares, 6);
    const value = round(shares * position.current_price, 2);

    if (shares <= 0 || value <= 0) {
        return null;
    }

    return {
        symbol: position.symbol,
        side,
        shares,
        value,
        price: round(position.current_price, 4),
    };
}

function finalizePlan(trades) {
    const cleanTrades = trades.filter(Boolean);
    const buyValue = round(
        cleanTrades
            .filter((trade) => trade.side === "buy")
            .reduce((sum, trade) => sum + trade.value, 0),
        2
    );
    const sellValue = round(
        cleanTrades
            .filter((trade) => trade.side === "sell")
            .reduce((sum, trade) => sum + trade.value, 0),
        2
    );

    return {
        trades: cleanTrades,
        trade_count: cleanTrades.length,
        buy_value: buyValue,
        sell_value: sellValue,
        net_value: round(buyValue - sellValue, 2),
    };
}

function distributeBudgetEvenly(positions, budget) {
    if (!positions.length || budget <= 0) {
        return [];
    }

    const allocationPerPosition = budget / positions.length;
    return positions.map((position) =>
        createTrade(position, "buy", allocationPerPosition / position.current_price)
    );
}

function buildRebalancePlan(action, portfolio) {
    const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
    const currentPositions = positions.filter(
        (position) => Number(position?.shares) > 0 && Number(position?.current_price) > 0
    );
    const tradablePositions = positions.filter(
        (position) => Number(position?.current_price) > 0
    );
    const totalValue = Number(portfolio?.total_value) || 0;

    if (!tradablePositions.length || totalValue <= 0) {
        return finalizePlan([]);
    }

    switch (action.strategy) {
        case "equal_weight": {
            if (!tradablePositions.length) {
                return finalizePlan([]);
            }

            const targetValue = totalValue / tradablePositions.length;
            return finalizePlan(
                tradablePositions.map((position) => {
                    const deltaValue = targetValue - position.value;
                    if (Math.abs(deltaValue) < 0.01) {
                        return null;
                    }

                    const side = deltaValue >= 0 ? "buy" : "sell";
                    return createTrade(position, side, Math.abs(deltaValue) / position.current_price);
                })
            );
        }

        case "sell_industry": {
            const matching = currentPositions.filter((position) => position.industry_sector === action.industry);
            return finalizePlan(matching.map((position) => createTrade(position, "sell", position.shares * 0.5)));
        }

        case "buy_industry": {
            const matching = tradablePositions.filter((position) => position.industry_sector === action.industry);
            return finalizePlan(distributeBudgetEvenly(matching, matching.length * 100));
        }

        case "sell_company_size": {
            const matching = currentPositions.filter((position) => position.company_size === action.company_size);
            return finalizePlan(matching.map((position) => createTrade(position, "sell", position.shares * 0.5)));
        }

        case "buy_company_size": {
            const matching = tradablePositions.filter((position) => position.company_size === action.company_size);
            return finalizePlan(distributeBudgetEvenly(matching, matching.length * 100));
        }

        case "sell_volatile": {
            const position = currentPositions.find((candidate) => candidate.symbol === action.symbol);
            return finalizePlan(position ? [createTrade(position, "sell", position.shares * 0.5)] : []);
        }

        default:
            return finalizePlan([]);
    }
}

function normalizeAction(rawAction) {
    const action = normalizeEnum(rawAction?.action, ACTION_TYPES);
    const strategy = normalizeEnum(rawAction?.strategy, STRATEGIES);
    const industry = normalizeEnum(rawAction?.industry, INDUSTRIES);
    const companySize = normalizeEnum(rawAction?.company_size, COMPANY_SIZES);

    return {
        label: cleanString(rawAction?.label) || "Untitled Action",
        action,
        strategy,
        industry,
        company_size: companySize,
        symbol: cleanString(rawAction?.symbol).toUpperCase() || undefined,
        timeframe: normalizeTimeframe(rawAction?.timeframe),
    };
}

function isValidStrategicAction(action) {
    if (action?.action !== "rebalance" || !STRATEGIES.has(action.strategy)) {
        return false;
    }

    if ((action.strategy === "sell_industry" || action.strategy === "buy_industry") && !action.industry) {
        return false;
    }

    if (
        (action.strategy === "sell_company_size" || action.strategy === "buy_company_size") &&
        !action.company_size
    ) {
        return false;
    }

    if (action.strategy === "sell_volatile" && !action.symbol) {
        return false;
    }

    return true;
}

function isValidQuickAction(action) {
    if (!action?.action || action.action === "rebalance" || !ACTION_TYPES.has(action.action)) {
        return false;
    }

    if (action.action === "open_ledger" && !action.symbol) {
        return false;
    }

    if (action.action === "analyze_timeframe" && !action.timeframe) {
        return false;
    }

    if (action.action === "highlight_industry" && !action.industry) {
        return false;
    }

    if (action.action === "highlight_size" && !action.company_size) {
        return false;
    }

    return true;
}

function dedupeKey(action) {
    return [
        action.action,
        action.strategy || "",
        action.symbol || "",
        action.timeframe || "",
        action.industry || "",
        action.company_size || "",
    ].join("|");
}

function normalizeModelActions(modelStrategicActions, modelQuickActions, portfolio) {
    const normalizedStrategicActions = Array.isArray(modelStrategicActions)
        ? modelStrategicActions.map(normalizeAction).filter((action) => action.action)
        : [];
    const normalizedQuickActions = Array.isArray(modelQuickActions)
        ? modelQuickActions.map(normalizeAction).filter((action) => action.action)
        : [];

    const strategicSeen = new Set();
    const strategicActions = normalizedStrategicActions
        .filter(isValidStrategicAction)
        .filter((action) => {
            const key = dedupeKey(action);
            if (strategicSeen.has(key)) {
                return false;
            }

            strategicSeen.add(key);
            return true;
        })
        .slice(0, 6);

    const quickByType = new Map();
    for (const action of normalizedQuickActions.filter(isValidQuickAction)) {
        if (!quickByType.has(action.action)) {
            quickByType.set(action.action, action);
        }
    }

    const quickActions = QUICK_ACTION_ORDER
        .map((actionType) => quickByType.get(actionType))
        .filter(Boolean);

    return {
        strategic_actions: strategicActions.map((action) => ({
            ...action,
            rebalance_plan: buildRebalancePlan(action, portfolio),
        })),
        quick_actions: quickActions,
    };
}

module.exports = {
    buildRebalancePlan,
    normalizeModelActions,
};
