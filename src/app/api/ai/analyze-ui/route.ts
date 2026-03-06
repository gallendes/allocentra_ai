import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const { image } = await req.json();

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
    });

    const result = await model.generateContent([
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

Identify:
- total portfolio value
- gains or losses
- concentration risks
- volatility warnings
- diversification suggestions

Return concise bullet points.
`
        }
    ]);

    const text = result.response.text();

    console.log("AI response:", text);

    return NextResponse.json({ insights: text });
}