# Analyze UI Cloud Run service

This service moves `src/app/api/ai/analyze-ui/route.ts` onto Google Cloud Run, calls Gemini through Vertex AI, and enriches the response with rebalance plans computed from live portfolio data.

## How it works

- `cloudrun/analyze_ui/index.js`: Entry point that sends the dashboard screenshot to Gemini for visual analysis, combines the model output with the user’s live portfolio data from Neon Postgres with portfolio.js, uses rebalance.js to turn strategic recommendations into executable trade plans, and returns insights, quick actions, and rebalance plans to the frontend
- `cloudrun/analyze_ui/rebalance.js`: Validates and normalizes Gemini's proposed actions, removes duplicates, and attaches a concrete rebalance plan for each strategic action based on current holdings.
- `cloudrun/analyze_ui/portfolio.js`: Queries Neon for the user's positions, prices, volatility, and allocation breakdowns, then builds the portfolio snapshot consumed by the rebalance logic.

## Environment variables

- `GOOGLE_CLOUD_PROJECT`: your Google Cloud project ID
- `GOOGLE_CLOUD_LOCATION`: Vertex AI region, for example `us-central1`
- `DATABASE_URL`: Neon connection string used by `portfolio.js`
- `GEMINI_MODEL`: optional, defaults to `gemini-2.5-flash`

## Deployment

```bash
cd cloudrun/analyze_ui

gcloud run deploy analyze-ui \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1,DATABASE_URL=YOUR_NEON_CONNECTION_STRING,GEMINI_MODEL=gemini-2.5-flash
```

After deployment:

1. We copy the service URL and set it in the Next.js app as:
```bash
ANALYZE_UI_BACKEND_URL=https://YOUR_CLOUD_RUN_URL
```

2. We `POST /` the screenshot and it returns `insights`, `strategic_actions`, and `quick_actions`

