#!/bin/bash
# Delete all Quo contacts by source (exact match)
# Usage: ./scripts/delete-quo-contacts-by-source.sh <api-key> <base-url> <source>
# Example: ./scripts/delete-quo-contacts-by-source.sh vhDsUjevRYF60RqwZiz8PE8n4ReXckUm https://dev-public-api.openphone.dev axiscare

API_KEY="${1:?Usage: $0 <api-key> <base-url> <source>}"
BASE_URL="${2:?Usage: $0 <api-key> <base-url> <source>}"
SOURCE="${3:?Usage: $0 <api-key> <base-url> <source>}"

deleted=0

echo "Deleting all contacts with source='${SOURCE}' (exact match) from ${BASE_URL}..."

# Phase 1: Collect all IDs to delete
echo "Fetching contact IDs..."
all_ids=""
page_token=""

while true; do
    url="${BASE_URL}/v1/contacts?maxResults=50&source=${SOURCE}"
    if [ -n "$page_token" ]; then
        url="${url}&pageToken=${page_token}"
    fi

    response=$(curl -s --max-time 15 -H "Authorization: ${API_KEY}" "$url")

    # Extract IDs where source exactly matches, and count of non-matching
    result=$(echo "$response" | python3 -c "
import json, sys
source = sys.argv[1]
d = json.load(sys.stdin)
matched = [c['id'] for c in d.get('data', []) if c.get('source') == source]
skipped = [c['source'] for c in d.get('data', []) if c.get('source') != source]
print(len(matched))
print(len(skipped))
for mid in matched:
    print(mid)
" "$SOURCE" 2>/dev/null)

    matched_count=$(echo "$result" | sed -n '1p')
    skipped_count=$(echo "$result" | sed -n '2p')
    ids=$(echo "$result" | tail -n +3)

    if [ -n "$ids" ] && [ "$matched_count" -gt 0 ] 2>/dev/null; then
        all_ids="${all_ids}${ids}"$'\n'
        echo "  Found ${matched_count} matching, ${skipped_count} skipped"
    elif [ "$skipped_count" -gt 0 ] 2>/dev/null; then
        echo "  Page had ${skipped_count} non-matching contacts, skipping"
    fi

    page_token=$(echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('nextPageToken',''))" 2>/dev/null)

    if [ -z "$page_token" ]; then
        echo "No more pages."
        break
    fi
done

# Count total
total=$(echo "$all_ids" | grep -c .)
echo ""
echo "Found ${total} contacts to delete. Proceeding..."

# Phase 2: Delete collected IDs
echo "$all_ids" | while IFS= read -r id; do
    [ -z "$id" ] && continue
    curl -s --max-time 10 -X DELETE -H "Authorization: ${API_KEY}" "${BASE_URL}/v1/contacts/${id}" > /dev/null
    deleted=$((deleted + 1))
    if [ $((deleted % 50)) -eq 0 ]; then
        echo "Deleted ${deleted}/${total} contacts..."
        sleep 1
    fi
done

echo "Done. Total deleted: ${total}"
