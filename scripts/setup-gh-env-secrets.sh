#!/usr/bin/env bash
#
# Sets GitHub environment secrets for quo--frigg from a .env file.
#
# Usage:
#   ./setup-gh-env-secrets.sh <environment> <env-file>
#
# Examples:
#   ./setup-gh-env-secrets.sh production backend/.env.production
#   ./setup-gh-env-secrets.sh dev backend/.env.dev
#
# Prerequisites:
#   - gh CLI installed and authenticated
#   - .env file with KEY=VALUE pairs (one per line)
#
# The script only sets secrets that the deploy workflows actually use
# (listed in backend/index.js environment block + AWS credentials).

set -euo pipefail

REPO="lefthookhq/quo--frigg"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <environment> <env-file>"
  echo ""
  echo "  environment: 'dev' or 'production'"
  echo "  env-file:    path to .env file with secrets"
  echo ""
  echo "Example: $0 production backend/.env.production"
  exit 1
fi

ENVIRONMENT="$1"
ENV_FILE="$2"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ File not found: $ENV_FILE"
  exit 1
fi

# Secrets the deploy workflows need (from index.js environment block + AWS creds)
REQUIRED_SECRETS=(
  # AWS credentials (used by configure-aws-credentials action)
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION

  # Core configuration (from index.js environment block)
  BASE_URL
  DATABASE_URL
  DATABASE_USER
  DATABASE_PASSWORD
  REDIRECT_URI
  HEALTH_API_KEY
  ADMIN_API_KEY
  FRIGG_API_KEY
  FRIGG_APP_USER_ID
  S3_BUCKET_NAME

  # Quo CRM
  QUO_BASE_URL
  QUO_API_KEY
  QUO_ANALYTICS_BASE_URL

  # AxisCare
  AXISCARE_API_KEY
  AXISCARE_BASE_URL

  # Attio (OAuth)
  ATTIO_CLIENT_ID
  ATTIO_CLIENT_SECRET
  ATTIO_SCOPE

  # PipeDrive (OAuth)
  PIPEDRIVE_CLIENT_ID
  PIPEDRIVE_CLIENT_SECRET
  PIPEDRIVE_SCOPE

  # Zoho CRM (OAuth)
  ZOHO_CRM_CLIENT_ID
  ZOHO_CRM_CLIENT_SECRET
  ZOHO_CRM_SCOPE

  # Clio
  CLIO_CLIENT_ID
  CLIO_CLIENT_SECRET

  # Misc
  SCALE_TEST_API_KEY
  SCHEDULER_PROVIDER
)

echo "=== Setting secrets for environment: $ENVIRONMENT ==="
echo "Reading from: $ENV_FILE"
echo ""

# Create the environment if it doesn't exist
echo "Creating environment '$ENVIRONMENT' (if it doesn't exist)..."
gh api "repos/$REPO/environments/$ENVIRONMENT" -X PUT > /dev/null 2>&1 || true
echo ""

SET_COUNT=0
SKIP_COUNT=0
MISSING=()

for secret_name in "${REQUIRED_SECRETS[@]}"; do
  # Extract value from .env file (handles KEY=VALUE, ignores comments and empty lines)
  value=$(grep -E "^${secret_name}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || true)

  if [ -n "$value" ]; then
    echo "$value" | gh secret set "$secret_name" --repo "$REPO" --env "$ENVIRONMENT"
    echo "  ✓ $secret_name"
    ((SET_COUNT++))
  else
    MISSING+=("$secret_name")
    ((SKIP_COUNT++))
  fi
done

echo ""
echo "=== Summary ==="
echo "  Set:     $SET_COUNT secrets"
echo "  Missing: $SKIP_COUNT secrets"

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "The following secrets were not found in $ENV_FILE:"
  echo "You'll need to set these manually with:"
  echo ""
  for m in "${MISSING[@]}"; do
    echo "  gh secret set $m --repo $REPO --env $ENVIRONMENT"
  done
fi

echo ""
echo "Done. Verify at: https://github.com/$REPO/settings/environments"
