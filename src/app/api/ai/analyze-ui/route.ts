import { NextResponse } from "next/server";

const ANALYZE_UI_BACKEND_URL = process.env.ANALYZE_UI_BACKEND_URL;

export async function POST(req: Request) {
    if (!ANALYZE_UI_BACKEND_URL) {
        return NextResponse.json(
            {
                error: "Missing ANALYZE_UI_BACKEND_URL. Point this route to your Cloud Run analyze-ui service."
            },
            { status: 500 }
        );
    }

    let payload: unknown;

    try {
        payload = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON request body" },
            { status: 400 }
        );
    }

    try {
        const backendResponse = await fetch(ANALYZE_UI_BACKEND_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            cache: "no-store"
        });

        const text = await backendResponse.text();

        return new NextResponse(text, {
            status: backendResponse.status,
            headers: {
                "Content-Type": backendResponse.headers.get("content-type") ?? "application/json"
            }
        });
    } catch (err: unknown) {
        console.error("POST /api/ai/analyze-ui proxy failed:", err);

        const message =
            err instanceof Error
                ? err.message
                : "Failed to reach analyze-ui backend";

        return NextResponse.json(
            { error: message },
            { status: 502 }
        );
    }
}
