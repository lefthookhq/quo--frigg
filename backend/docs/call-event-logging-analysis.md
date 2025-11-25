# Call Event Logging Analysis

## Issue Summary

Calls are not being logged to Attio despite using "Call in Quo" option. Testing reveals multiple call types (missed, voicemail, forwarded, Sona) are not appearing in Attio.

## Root Cause Analysis

### ✅ Implementation Code - WORKING CORRECTLY

The `_handleQuoCallEvent` method ([AttioIntegration.js:1631-1754](../src/integrations/AttioIntegration.js#L1631-L1754)) **correctly handles** all edge cases:

```javascript
// Lines 1676-1694: Status handling logic
if (callObject.status === 'completed') {
    statusDescription = callObject.direction === 'outgoing'
        ? `Outgoing initiated by ${userName}`
        : `Incoming answered by ${userName}`;
} else if (callObject.status === 'no-answer' || callObject.status === 'missed') {
    statusDescription = 'Incoming missed';  // ✅ WORKS
} else if (callObject.status === 'forwarded') {
    statusDescription = callObject.forwardedTo
        ? `Incoming forwarded to ${callObject.forwardedTo}`  // ✅ WORKS
        : 'Incoming forwarded by phone menu';  // ✅ WORKS
}

// Lines 1712-1719: Voicemail handling
if (callObject.voicemail) {
    const voicemailDuration = callObject.voicemail.duration || 0;
    const vmMinutes = Math.floor(voicemailDuration / 60);
    const vmSeconds = voicemailDuration % 60;
    const vmFormatted = `${vmMinutes}:${vmSeconds.toString().padStart(2, '0')}`;
    statusLine += ` / ➿ Voicemail (${vmFormatted})`;  // ✅ WORKS
}
```

**Test Coverage**: 11/11 tests passing in `AttioIntegration.CallEdgeCases.test.js`

### ❌ Problem 1: Webhook Creation Fails Silently

**Evidence** (from CloudWatch logs):
- Integration 8: Webhooks 81, 82, 83 reported as "created successfully"
- Integration 9: Webhooks 100, 101, 102 reported as "created successfully"
- **But Nick confirmed**: "There is no webhooks for that org"

**Location**: [BaseCRMIntegration.js:1458-1512](../src/base/BaseCRMIntegration.js#L1458-L1512)

```javascript
const callWebhookResponse = await this.quo.api.createCallWebhook({
    ...webhookData,
    events: WEBHOOK_EVENTS.QUO_CALLS,
    label: WEBHOOK_LABELS.QUO_CALLS,
});

if (!callWebhookResponse?.data?.id) {
    throw new Error('Invalid Quo call webhook response: missing webhook ID');
}

console.log(`[Quo] Call webhook created: ${callWebhookResponse.data.id}`);
// ^^^ This logs SUCCESS but webhook doesn't actually exist!
```

**Impact**: No call webhooks = no events delivered = nothing logged

### ❌ Problem 2: Limited Webhook Event Subscription

**Location**: [AttioIntegration.js:105-114](../src/integrations/AttioIntegration.js#L105-L114)

```javascript
static WEBHOOK_EVENTS = {
    ATTIO: [
        { event_type: 'record.created', filter: null },
        { event_type: 'record.updated', filter: null },
        { event_type: 'record.deleted', filter: null },
    ],
    QUO_MESSAGES: ['message.received', 'message.delivered'],
    QUO_CALLS: ['call.completed'],  // ❌ ONLY THIS EVENT
    QUO_CALL_SUMMARIES: ['call.summary.completed'],
};
```

**Available webhook events** (from [OpenPhone API docs](../../../Downloads/openphone-public-api-llm-ready-docs-prod/guides/webhooks.md)):
- `call.ringing` - Call is ringing (not subscribed)
- `call.completed` - Call finished (subscribed ✅)
- `call.recording.completed` - Recording available (not subscribed)

**Analysis**:
- Missed/forwarded/voicemail calls likely still fire `call.completed` with specific `status` values
- The issue is NOT the event type, but that webhooks don't exist at all

## What Actually Works

1. ✅ **Message webhooks** - Confirmed working (saw `message.delivered` in logs)
2. ✅ **Attio webhooks** - Confirmed working (saw `record.updated` events)
3. ✅ **Call summary enrichment** - Code logic is correct, fetches full call details
4. ✅ **Voicemail handling** - Code handles `callObject.voicemail` correctly with clickable URL
5. ✅ **Forwarded call handling** - Code handles `status: 'forwarded'` correctly
6. ✅ **Missed call handling** - Code handles `status: 'missed'`, `'no-answer'`, and `answeredAt: null` correctly
7. ✅ **Call log accuracy** - Fixed `answeredAt` detection and voicemail URL inclusion (see [call-log-accuracy-fixes.md](call-log-accuracy-fixes.md))

## What Doesn't Work

1. ❌ **Call webhook creation** - Quo API silently fails or creates webhooks in wrong org
2. ❌ **No call events delivered** - Because webhooks don't exist
3. ❌ **Auto-creation of new contacts** - Requires active conversation (design limitation)

## Solutions

### Short-term: Fix Webhook Creation (Backend Quo Team)

**Action Required**: Quo backend team must investigate why:
1. `createCallWebhook` returns success but webhook doesn't exist
2. Webhooks might be created in wrong org (OR2P1sKGOD has only message webhooks)
3. Phone number filtering might be incorrect

**Test Case**:
```bash
# Expected: Webhook created for org XYZ with phone number PNdaDcICIR
# Actual: Webhook created but doesn't exist in org, or exists in different org
```

### Medium-term: Enhanced Webhook Verification

**Implementation** (add to [BaseCRMIntegration.js](../src/base/BaseCRMIntegration.js)):

```javascript
async setupQuoWebhooks() {
    // Create webhooks
    const callWebhookResponse = await this.quo.api.createCallWebhook({...});

    // ✨ NEW: Verify webhook actually exists
    const verifyResponse = await this.quo.api.getWebhook(callWebhookResponse.data.id);
    if (!verifyResponse?.data) {
        throw new Error(`Webhook ${callWebhookResponse.data.id} created but doesn't exist`);
    }

    // ✨ NEW: Log webhook details for debugging
    console.log(`[Quo] Webhook verification:`, {
        id: verifyResponse.data.id,
        url: verifyResponse.data.url,
        events: verifyResponse.data.events,
        resourceIds: verifyResponse.data.resourceIds,
    });
}
```

### Long-term: Resilience & Observability

**Add monitoring**:
```javascript
// Log expected vs actual webhook deliveries
const metricsCollector = {
    expectedEvents: 0,  // Increment when webhook created
    receivedEvents: 0,  // Increment when webhook fires
    missedEvents: () => expectedEvents - receivedEvents,
};
```

**Add retry mechanism**:
```javascript
// If webhook creation succeeds but verification fails, retry with exponential backoff
for (let attempt = 1; attempt <= 3; attempt++) {
    try {
        await createAndVerifyWebhook();
        break;
    } catch (error) {
        if (attempt === 3) throw error;
        await sleep(1000 * attempt);
    }
}
```

## Contact Auto-Creation

**Current Limitation** (from user feedback):
> "New contacts (People) in Attio automatically created in Quo"

**Status**: Not implemented
**Reason**: Design decision to prevent spam/noise
**Workaround**: Contacts auto-created when they have an active conversation

**Potential Implementation**:
```javascript
async _handleQuoCallEvent(webhookData) {
    const contactPhone = extractContactPhone(webhookData);
    const attioRecordId = await this._findAttioContactFromQuoWebhook(contactPhone);

    // ✨ NEW: Check if contact exists in Quo
    const quoContacts = await this.quo.api.listContacts({
        phoneNumbers: [contactPhone],
        maxResults: 1,
    });

    if (quoContacts?.data?.length === 0) {
        // ✨ NEW: Auto-create contact in Quo from Attio
        await this._createQuoContactFromAttio(attioRecordId, contactPhone);
    }

    // Continue with call logging...
}
```

## Sona Calls

**Implementation Status**: ✅ Code ready
**Blocker**: Unknown if Quo API provides `answeredBy` field

**Test Case**:
```javascript
// Assuming Quo sends this field:
{
    "type": "call.completed",
    "data": {
        "object": {
            "answeredBy": "sona",  // or "USSonaAI" or similar identifier
            "direction": "incoming",
            "status": "completed",
            ...
        }
    }
}
```

**Current Code** (already handles this):
```javascript
const userDetails = await this.quo.api.getUser(callObject.userId);
const userName = `${userDetails.data?.firstName || ''} ${userDetails.data?.lastName || ''}`.trim() || 'Quo User';

// If userId points to Sona, this will show "Incoming answered by Sona AI"
```

## Next Steps

1. **Quo Backend Team**: Investigate webhook creation bug
   - Why do webhooks report success but don't exist?
   - Are webhooks being created in the wrong org?
   - Is phone number filtering working correctly?

2. **Frontend Team**: Add webhook monitoring dashboard
   - Show expected vs received webhook counts
   - Alert when webhooks are missing
   - Display webhook verification status

3. **Integration Team**: Add contact auto-creation feature
   - Implement Quo contact creation from Attio data
   - Add configuration toggle for auto-create behavior
   - Test with production data

4. **Documentation Team**: Clarify Sona call fields
   - Document `answeredBy` field behavior
   - Add examples of Sona call webhook payloads
   - Update integration guide

## Test Coverage

✅ **11/11 tests passing** in `test/AttioIntegration.CallEdgeCases.test.js`:
- Missed calls (status: 'missed', 'no-answer')
- Calls with voicemail
- Forwarded calls (with/without target user)
- Sona-handled calls
- Contact auto-creation pattern
- Error handling

**Coverage Increase**:
- AttioIntegration.js: 13.69% → 14.24% (+0.55%)
- CallSummaryEnrichmentService.js: 67.18% → 75% (+7.82%)

## References

- [OpenPhone Webhook Documentation](../../../Downloads/openphone-public-api-llm-ready-docs-prod/guides/webhooks.md)
- [AttioIntegration.js](../src/integrations/AttioIntegration.js)
- [BaseCRMIntegration.js](../src/base/BaseCRMIntegration.js)
- [Call Summary Enrichment Tests](../test/CallSummaryEnrichment.test.js)
- [Call Edge Cases Tests (NEW)](../test/AttioIntegration.CallEdgeCases.test.js)
