#!/bin/bash

# Frigg Attio Initial Sync Script
# Triggers an initial sync for the Attio integration
# 
# Usage: ./frigg-attio-initial-sync.sh [INTEGRATION_ID]
#
# Authentication Methods:
# 1. JWT Token (default): Logs in with demo@demo.com
# 2. Shared Secret: Set FRIGG_API_KEY and FRIGG_APP_USER_ID environment variables
#
# Example with shared secret:
#   FRIGG_API_KEY="your-key" FRIGG_APP_USER_ID="your-user" ./frigg-attio-initial-sync.sh 1

FRIGG_URL="http://localhost:3001"
INTEGRATION_ID="${1:-1}"

echo "=== Frigg Attio Initial Sync ==="
echo "Integration ID: ${INTEGRATION_ID}"
echo ""

# Check if shared secret authentication is available
if [ -n "$FRIGG_API_KEY" ] && [ -n "$FRIGG_APP_USER_ID" ]; then
  echo "Using shared secret authentication"
  echo "App User ID: ${FRIGG_APP_USER_ID}"
  echo ""
  
  # Trigger initial sync with shared secret
  echo "Triggering initial sync..."
  SYNC_RESPONSE=$(curl -s -X POST "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}/actions/INITIAL_SYNC" \
    -H "x-frigg-api-key: ${FRIGG_API_KEY}" \
    -H "x-frigg-appuserid: ${FRIGG_APP_USER_ID}" \
    -H "Content-Type: application/json" \
    -d '{}')
else
  # Use JWT token authentication
  echo "Using JWT token authentication"
  echo ""
  
  # Step 1: Login to get token
  echo "Step 1: Logging in as demo@demo.com..."
  LOGIN_RESPONSE=$(curl -s -X POST "${FRIGG_URL}/user/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "demo@demo.com", "password": "demo"}')

  # Extract token from response
  TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$TOKEN" ]; then
    echo "Error: Failed to get token" >&2
    echo "Response: $LOGIN_RESPONSE" >&2
    exit 1
  fi

  # Decode token to get user ID
  DECODED=$(echo "$TOKEN" | base64 -d 2>/dev/null)
  USER_ID=$(echo "$DECODED" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$USER_ID" ]; then
    echo "Error: Failed to decode user ID from token" >&2
    exit 1
  fi

  echo "✓ Login successful (User ID: ${USER_ID})"
  echo ""

  # Step 2: Trigger initial sync
  echo "Step 2: Triggering initial sync..."
  SYNC_RESPONSE=$(curl -s -X POST "${FRIGG_URL}/api/integrations/${INTEGRATION_ID}/actions/INITIAL_SYNC" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "x-frigg-user-id: ${USER_ID}" \
    -H "Content-Type: application/json" \
    -d '{}')
fi

# Check for errors
if echo "$SYNC_RESPONSE" | grep -q '"error"'; then
  echo "✗ Error: $SYNC_RESPONSE" >&2
  exit 1
fi

# Pretty print response
echo "✓ Sync initiated successfully!"
echo ""
echo "Response:"
echo "$SYNC_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SYNC_RESPONSE"
