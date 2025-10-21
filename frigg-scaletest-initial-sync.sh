#!/bin/bash

# Frigg Scale Test Initial Sync Script
# Logs in with demo@demo.com, then triggers an initial sync for the Scale Test integration
# Usage: ./frigg-scaletest-initial-sync.sh [INTEGRATION_ID]

FRIGG_URL="http://localhost:3001"
INTEGRATION_ID="${1:-3}"

echo "=== Frigg Scale Test Initial Sync ==="
echo "Integration ID: ${INTEGRATION_ID}"
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
