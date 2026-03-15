export const AI_ACTION_TYPES = [
    "rebalance",
    "open_ledger",
    "analyze_timeframe",
    "highlight_industry",
    "highlight_size",
] as const;

export const REBALANCE_STRATEGIES = [
    "equal_weight",
    "sell_industry",
    "buy_industry",
    "sell_company_size",
    "buy_company_size",
    "sell_volatile",
] as const;

export const INDUSTRY_KEYS = [
    "energy",
    "healthcare",
    "industrials",
    "communication_services",
    "information_technology",
    "consumer_staples",
] as const;

export const COMPANY_SIZE_KEYS = [
    "small_cap",
    "mid_cap",
    "large_cap",
    "mega_cap",
] as const;

export const AI_TIMEFRAMES = ["1D", "5D", "1M", "6M", "1Y", "5Y"] as const;

export type AIActionType = (typeof AI_ACTION_TYPES)[number];
export type RebalanceStrategy = (typeof REBALANCE_STRATEGIES)[number];
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];
export type CompanySizeKey = (typeof COMPANY_SIZE_KEYS)[number];
export type AIActionTimeframe = (typeof AI_TIMEFRAMES)[number];

export type RebalanceTrade = {
    symbol: string;
    side: "buy" | "sell";
    shares: number;
    value: number;
    price: number;
};

export type RebalancePlan = {
    trades: RebalanceTrade[];
    trade_count: number;
    buy_value: number;
    sell_value: number;
    net_value: number;
};

type BaseAIAction = {
    label: string;
    action: AIActionType;
    symbol?: string;
    timeframe?: AIActionTimeframe | string;
    strategy?: RebalanceStrategy;
    industry?: IndustryKey;
    company_size?: CompanySizeKey;
};

export type StrategicAction = BaseAIAction & {
    action: "rebalance";
    strategy: RebalanceStrategy;
    rebalance_plan: RebalancePlan;
};

export type QuickAction = BaseAIAction & {
    action:
        | "open_ledger"
        | "analyze_timeframe"
        | "highlight_industry"
        | "highlight_size";
};

export type AnalyzeUIResponse = {
    insights: string;
    strategic_actions: StrategicAction[];
    quick_actions: QuickAction[];
};
