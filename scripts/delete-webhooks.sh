#!/bin/bash

# Script to delete all webhooks from OpenPhone API
# Usage: ./delete-webhooks.sh <base_url> <api_key>

set -e  # Exit on any error

if [ $# -ne 2 ]; then
    echo "Usage: $0 <base_url> <api_key>"
    echo "Example: $0 https://api.openphone.com 4qScqyseEX4rvLd9Gp0g8BglWNXrTRgd"
    exit 1
fi

BASE_URL="$1"
API_KEY="$2"

echo "Listing webhooks from $BASE_URL..."

# List all webhooks
WEBHOOKS_RESPONSE=$(curl -s -H "Authorization: $API_KEY" "$BASE_URL/v2/webhooks")

# Check if the response is valid JSON
if ! echo "$WEBHOOKS_RESPONSE" | jq . >/dev/null 2>&1; then
    echo "Error: Invalid response from API"
    echo "Response: $WEBHOOKS_RESPONSE"
    exit 1
fi

# Extract webhook IDs
WEBHOOK_IDS=$(echo "$WEBHOOKS_RESPONSE" | jq -r '.data[].id' 2>/dev/null || echo "")

if [ -z "$WEBHOOK_IDS" ]; then
    echo "No webhooks found to delete."
    exit 0
fi

echo "Found webhooks with IDs: $WEBHOOK_IDS"
echo "Deleting webhooks..."

# Delete each webhook
for id in $WEBHOOK_IDS; do
    echo "Deleting webhook $id..."
    DELETE_RESPONSE=$(curl -s -X DELETE -H "Authorization: $API_KEY" "$BASE_URL/v2/webhooks/$id")
    
    # Check if delete was successful (should return empty or 204)
    if [ -z "$DELETE_RESPONSE" ] || echo "$DELETE_RESPONSE" | jq -e '.data' >/dev/null 2>&1; then
        echo "Successfully deleted webhook $id"
    else
        echo "Warning: Unexpected response when deleting webhook $id: $DELETE_RESPONSE"
    fi
done

echo "All webhooks deleted successfully."

# Verify by listing again
echo "Verifying deletion..."
VERIFY_RESPONSE=$(curl -s -H "Authorization: $API_KEY" "$BASE_URL/v2/webhooks")
REMAINING_COUNT=$(echo "$VERIFY_RESPONSE" | jq -r '.data | length' 2>/dev/null || echo "unknown")

if [ "$REMAINING_COUNT" = "0" ]; then
    echo "Verification successful: No webhooks remaining."
else
    echo "Warning: $REMAINING_COUNT webhooks still exist after deletion."
fi