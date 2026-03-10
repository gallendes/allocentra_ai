import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const { image } = await req.json();

    const genAI = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY!
    });

    try {
        const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    inlineData: {
                        mimeType: "image/png",
                        data: image.replace(/^data:image\/png;base64,/, "")
                    }
                },
                {
                    text: `
You are a financial portfolio assistant.

Analyze the dashboard screenshot.

---------------

1) Identify:
- total portfolio value
- gains or losses including
    1) PNL in the line graph's timeframe (1D, 5D, 1M, 6M, 1Y, 5Y). Do NOT assume it's daily gain or loss. It is the timeframe's gain or loss.
    2) Daily and total PNL from the portfolio summary. 
- concentration risks
- volatility warnings
- diversification suggestions in terms of 1) industry diversification, 2) company size, and 3) volatility management  

Return concise bullet points.
Do not insert more than one blank line between sections.

---------------

2) Return the result as valid JSON with the following schema:
{
  "insights": "markdown analysis from step 1",
  "actions": [
    {
      "label": "short UI label for an action the user could take",
      "action": "one of: rebalance | open_ledger | analyze_symbol | analyze_timeframe",
      "symbol": "optional stock symbol",
      "timeframe": "optional timeframe"
    }
  ]
}

---------------

Rules:
- Only include actions that make sense based on the portfolio shown. Your context is limited to the 7 symbols visible in the screenshot.
    - rebalance means adjusting the portfolio's allocation percentages by selling overweight positions and buying underweight positions.
    - open_ledger means opening the transaction ledger for a symbol in the portfolio.
    - analyze_symbol means performing an analytical review of a symbol including volatility, performance, and risk based on your general knowledge of the company, its size, industry sector, and typical market dynamics; reasonable inferred insights are acceptable.
    - analyze_timeframe means clicking one of the timeframe chips (1D, 5D, 1M, 6M, 1Y, 5Y) to view the portfolio's performance in that timeframe.
- Return exactly 4 actions. No more, no fewer.
- Use short labels suitable for clickable UI chips.
- Return valid JSON only. No commentary outside the JSON.
`
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
                        actions: {
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
                                            "rebalance",
                                            "open_ledger",
                                            "analyze_symbol",
                                            "analyze_timeframe"
                                        ]
                                    },
                                    symbol: {
                                        type: Type.STRING
                                    },
                                    timeframe: {
                                        type: Type.STRING
                                    }
                                },
                                required: ["label", "action"]
                            }
                        }
                    },
                    required: ["insights", "actions"]
                }
            }
        });
        const text = result.text;
        console.log("Gemini response:", text);
        let parsed;
        try {
            if (text) {
                parsed = JSON.parse(text);
            }
            console.log("Gemini response Parsed:", parsed);
        } catch {
            parsed = { insights: text, actions: [] };
        }
        return NextResponse.json(parsed);
    } catch (err: any) {
        console.error("GET /api/ai/analyze-ui failed:", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: err.status }
        );
    }
}
