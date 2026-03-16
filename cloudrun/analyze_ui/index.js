/*
 * How it works:
 * - index.js accepts the screenshot request, sends the image to Gemini, waits
 *   for Gemini's JSON response, loads the user's live portfolio snapshot using
 *   portfolio.js, asks rebalance.js to calculate trades for the strategic actions,
 *   then returns Gemini's insights and actions enriched with those calculated
 *   rebalance plans.
 * - rebalance.js validates and normalizes Gemini's proposed actions, removes
 *   duplicates, and attaches a concrete rebalance plan for each strategic action
 *   based on current holdings.
 * - portfolio.js queries Neon for the user's positions, prices, volatility, and
 *   allocation breakdowns, then builds the portfolio snapshot consumed by the
 *   rebalance logic.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { GoogleGenAI, Type } = require("@google/genai");

const { getPortfolioSnapshot } = require("./portfolio");
const { normalizeModelActions } = require("./rebalance");

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PROJECT =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

const PROMPT = `
You are a financial portfolio assistant.

Analyze the dashboard screenshot.

1) Write "insights" as concise markdown using exactly these 5 sections in this exact order.

## Portfolio Summary
- total portfolio value
- line chart timeframe PNL
- daily PNL
- total PNL

Important:
- State the selected chart timeframe and read the timeframe PNL directly 
from the gain/loss badge at the top left of the line chart card, 
immediately next to the total portfolio value, reporting both the amount 
and percentage exactly as shown; only call it daily PNL when the timeframe is 1D  

## Risk Signals
- concentration risks
- volatility warnings

## Diversification Opportunities
- industry diversification suggestions
- company size diversification suggestions
- volatility management suggestions

## Key Takeaways
- 2 to 4 short bullets with the most important conclusions

## Recommended Focus
- 1 short paragraph describing the single highest-priority area to watch next

Formatting rules for "insights":
- Use exactly the section headings shown above
- Put 1 to 4 concise bullets under each heading, except "Recommended Focus", which must be a short paragraph
- Do not merge sections
- Do not omit sections
- If a section has no meaningful content, write exactly: - None
- Do not add any headings other than the 5 listed above
- Keep the writing concise and scannable

2) Return valid JSON only with this exact top-level shape:
{
  "insights": "string",
  "strategic_actions": [...],
  "quick_actions": [...]
}

3) Interpret the following action variants as a strict contract.
For every object:
- include all required fields
- include no fields outside allowed_fields
- labels are not a substitute for structured fields

Strategic action variants:
- equal_weight
  - required_fields: ["label", "action", "strategy"]
  - allowed_fields: ["label", "action", "strategy"]
  - fixed_values: { "action": "rebalance", "strategy": "equal_weight" }

- sell_industry
  - required_fields: ["label", "action", "strategy", "industry"]
  - allowed_fields: ["label", "action", "strategy", "industry"]
  - fixed_values: { "action": "rebalance", "strategy": "sell_industry" }

- buy_industry
  - required_fields: ["label", "action", "strategy", "industry"]
  - allowed_fields: ["label", "action", "strategy", "industry"]
  - fixed_values: { "action": "rebalance", "strategy": "buy_industry" }

- sell_company_size
  - required_fields: ["label", "action", "strategy", "company_size"]
  - allowed_fields: ["label", "action", "strategy", "company_size"]
  - fixed_values: { "action": "rebalance", "strategy": "sell_company_size" }

- buy_company_size
  - required_fields: ["label", "action", "strategy", "company_size"]
  - allowed_fields: ["label", "action", "strategy", "company_size"]
  - fixed_values: { "action": "rebalance", "strategy": "buy_company_size" }

- sell_volatile
  - required_fields: ["label", "action", "strategy", "symbol"]
  - allowed_fields: ["label", "action", "strategy", "symbol"]
  - fixed_values: { "action": "rebalance", "strategy": "sell_volatile" }

Quick action variants:
- open_ledger
  - required_fields: ["label", "action", "symbol"]
  - allowed_fields: ["label", "action", "symbol"]
  - fixed_values: { "action": "open_ledger" }

- analyze_timeframe
  - required_fields: ["label", "action", "timeframe"]
  - allowed_fields: ["label", "action", "timeframe"]
  - fixed_values: { "action": "analyze_timeframe" }

- highlight_industry
  - required_fields: ["label", "action", "industry"]
  - allowed_fields: ["label", "action", "industry"]
  - fixed_values: { "action": "highlight_industry" }

- highlight_size
  - required_fields: ["label", "action", "company_size"]
  - allowed_fields: ["label", "action", "company_size"]
  - fixed_values: { "action": "highlight_size" }

Allowed enum values:
- industry: ["energy", "healthcare", "industrials", "communication_services", "information_technology", "consumer_staples"]
- company_size: ["small_cap", "mid_cap", "large_cap", "mega_cap"]
- timeframe: ["1D", "5D", "1M", "6M", "1Y", "5Y"]

Output requirements:
- "strategic_actions" must contain exactly 6 objects
- "strategic_actions" must contain exactly one object for each strategy:
  - "equal_weight"
  - "sell_industry"
  - "buy_industry"
  - "sell_company_size"
  - "buy_company_size"
  - "sell_volatile"
- "quick_actions" must contain exactly 4 objects
- "quick_actions" must contain exactly one object for each action:
  - "open_ledger"
  - "analyze_timeframe"
  - "highlight_industry"
  - "highlight_size"
- Do not return any fields that are not explicitly allowed by the chosen variant
- Do not return any commentary outside the JSON
`

if (!PROJECT) {
    console.warn("GOOGLE_CLOUD_PROJECT is not set. Vertex AI calls will fail until it is configured.");
}

const genAI = new GoogleGenAI({
    vertexai: true,
    project: PROJECT,
    location: LOCATION,
    apiVersion: "v1"
});

function parseResponseText(text) {
    if (!text) {
        return { insights: "", strategic_actions: [], quick_actions: [] };
    }

    try {
        return JSON.parse(text);
    } catch {
        return { insights: text, strategic_actions: [], quick_actions: [] };
    }
}

function getImageData(image) {
    if (typeof image !== "string" || image.length === 0) {
        return null;
    }

    return image.replace(/^data:image\/png;base64,/, "");
}

exports.main = async (req, res) => {
    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            service: "analyze-ui",
            project: PROJECT || null,
            location: LOCATION,
            model: MODEL
        });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const image = getImageData(req.body?.image);
        const username =
            typeof req.body?.username === "string" && req.body.username.trim()
                ? req.body.username.trim()
                : "sea_otter";

        if (!image) {
            return res.status(400).json({ error: "Missing image" });
        }

        const result = await genAI.models.generateContent({
            model: MODEL,
            contents: [
                {
                    inlineData: {
                        mimeType: "image/png",
                        data: image
                    }
                },
                {
                    text: PROMPT
                }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        insights: {
                            type: Type.STRING
                        },
                        strategic_actions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    label: {
                                        type: Type.STRING
                                    },
                                    action: {
                                        type: Type.STRING,
                                        enum: ["rebalance"]
                                    },
                                    strategy: {
                                        type: Type.STRING,
                                        enum: [
                                            "equal_weight",
                                            "sell_industry",
                                            "buy_industry",
                                            "sell_company_size",
                                            "buy_company_size",
                                            "sell_volatile"
                                        ]
                                    },
                                    industry: {
                                        type: Type.STRING,
                                        enum: [
                                            "energy",
                                            "healthcare",
                                            "industrials",
                                            "communication_services",
                                            "information_technology",
                                            "consumer_staples"
                                        ]
                                    },
                                    company_size: {
                                        type: Type.STRING,
                                        enum: [
                                            "small_cap",
                                            "mid_cap",
                                            "large_cap",
                                            "mega_cap"
                                        ]
                                    },
                                    symbol: {
                                        type: Type.STRING
                                    }
                                },
                                required: ["label", "action", "strategy"]
                            }
                        },
                        quick_actions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    label: {
                                        type: Type.STRING
                                    },
                                    action: {
                                        type: Type.STRING,
                                        enum: [
                                            "open_ledger",
                                            "analyze_timeframe",
                                            "highlight_industry",
                                            "highlight_size"
                                        ]
                                    },
                                    industry: {
                                        type: Type.STRING,
                                        enum: [
                                            "energy",
                                            "healthcare",
                                            "industrials",
                                            "communication_services",
                                            "information_technology",
                                            "consumer_staples"
                                        ]
                                    },
                                    company_size: {
                                        type: Type.STRING,
                                        enum: [
                                            "small_cap",
                                            "mid_cap",
                                            "large_cap",
                                            "mega_cap"
                                        ]
                                    },
                                    symbol: {
                                        type: Type.STRING
                                    },
                                    timeframe: {
                                        type: Type.STRING,
                                        enum: ["1D", "5D", "1M", "6M", "1Y", "5Y"]
                                    }
                                },
                                required: ["label", "action"]
                            }
                        }
                    },
                    required: ["insights", "strategic_actions", "quick_actions"]
                }
            }
        });

        console.log("Gemini raw response:", result.text);

        const parsed = parseResponseText(result.text);
        console.log("Gemini parsed response:", parsed);

        const portfolio = await getPortfolioSnapshot(username);
        const normalizedActions = normalizeModelActions(
            parsed.strategic_actions,
            parsed.quick_actions,
            portfolio
        );
        const response = {
            insights: typeof parsed.insights === "string" ? parsed.insights : "",
            strategic_actions: normalizedActions.strategic_actions,
            quick_actions: normalizedActions.quick_actions
        };

        console.log("analyze-ui response generated", {
            username,
            hasInsights: Boolean(response.insights),
            strategicActions: response.strategic_actions.length,
            quickActions: response.quick_actions.length
        });

        return res.status(200).json(response);
    } catch (err) {
        console.error("analyze-ui failed", err);

        return res.status(err?.status || 500).json({
            error: err?.message || "Internal server error"
        });
    }
};
