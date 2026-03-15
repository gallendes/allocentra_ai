#!/bin/bash


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

set -a
source "$ROOT_DIR/.env.local"
set +a

gcloud run deploy analyze-ui \
  --source "$ROOT_DIR/cloudrun/analyze_ui" \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT \
  --set-env-vars GOOGLE_CLOUD_LOCATION=$GOOGLE_CLOUD_LOCATION \
  --set-env-vars DATABASE_URL=$DATABASE_URL \
  --set-env-vars GEMINI_MODEL=$GEMINI_MODEL