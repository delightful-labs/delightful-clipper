#!/usr/bin/env bash
set -eu

# Require the exact proof app rather than inheriting the production app.
if [ "${BRANCH:-}" != "research/atproto-jwt-proof" ] || [ "${CONTEXT:-}" = "production" ]; then
  echo 'AT Protocol proof build requires the non-production proof branch.' >&2
  exit 1
fi

if [ "${PUBLIC_JAZZ_APP_ID:-}" != "922a7e18-89b5-49d3-9f5b-f4fe20c48a9b" ]; then
  echo 'AT Protocol proof build requires its dedicated Jazz test app ID.' >&2
  exit 1
fi
: "${JAZZ_ADMIN_SECRET:?Set the dedicated Jazz test admin secret for this branch in Netlify}"
: "${PUBLIC_JAZZ_SERVER_URL:?Set the Jazz test server URL in Netlify}"

export JAZZ_APP_ID="$PUBLIC_JAZZ_APP_ID"
export JAZZ_SERVER_URL="$PUBLIC_JAZZ_SERVER_URL"
export JAZZ_ACCOUNT_REGISTRY="${PUBLIC_JAZZ_SERVER_URL%/}/apps/$PUBLIC_JAZZ_APP_ID/accounts"

pnpm deploy:jazz

# The frontend build does not need administration credentials.
unset JAZZ_ADMIN_SECRET
pnpm build
