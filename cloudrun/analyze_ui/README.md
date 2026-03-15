# Analyze UI Cloud Run service

This service moves `src/app/api/ai/analyze-ui/route.ts` onto Google Cloud Run, calls Gemini through Vertex AI, and enriches the response with rebalance plans computed from live portfolio data.

## Environment variables

- `GOOGLE_CLOUD_PROJECT`: your Google Cloud project ID
- `GOOGLE_CLOUD_LOCATION`: Vertex AI region, for example `us-central1`
- `DATABASE_URL`: Neon connection string used by `portfolio.js`
- `GEMINI_MODEL`: optional, defaults to `gemini-2.5-flash`

## Local run

```bash
cd cloudrun/analyze_ui
npm install
npm start
```

The service exposes:

- `GET /`: health/config response
- `POST /`: analyze a dashboard screenshot and return `insights`, `strategic_actions`, and `quick_actions`

`POST /` requires both Vertex AI configuration and `DATABASE_URL`, because the service computes rebalance plans from the current portfolio snapshot.

## Deploy

```bash
cd cloudrun/analyze_ui

gcloud run deploy analyze-ui \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1,DATABASE_URL=YOUR_NEON_CONNECTION_STRING,GEMINI_MODEL=gemini-2.5-flash
```

After deploy:

1. Open the service URL or `curl` it. A `GET` request should return a JSON health response.
2. Copy the service URL and set it in the Next.js app as:

```bash
ANALYZE_UI_BACKEND_URL=https://YOUR_CLOUD_RUN_URL
```

If `npm install @neondatabase/serverless` worked locally but the deployed service still fails, the usual cause is not the package install itself. For Cloud Run source deploys, Google installs dependencies from this folder's `package.json` during build. The common failure cases are:

- deployed from the wrong directory instead of `cloudrun/analyze_ui`
- `DATABASE_URL` missing from Cloud Run env vars
- `GOOGLE_CLOUD_PROJECT` missing from Cloud Run env vars
- Next.js app not updated with `ANALYZE_UI_BACKEND_URL`

## Proof for the hackathon

Any of these are enough:

1. Record the Cloud Run service details page and the request logs while triggering an AI analysis from the app.
2. Point reviewers to `cloudrun/analyze_ui/index.js`, `cloudrun/analyze_ui/rebalance.js`, and `cloudrun/analyze_ui/portfolio.js`, which show Vertex AI usage plus server-side rebalance-plan enrichment.
