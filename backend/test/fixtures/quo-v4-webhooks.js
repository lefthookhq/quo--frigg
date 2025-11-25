/**
 * Test Fixtures for Quo v4 API Webhooks
 *
 * Anonymized webhook payloads based on real v4 API responses.
 * All phone numbers, IDs, and personal information have been anonymized.
 */

/**
 * Phone Numbers Metadata - Used to filter participants
 * Shape matches integration config.phoneNumbersMetadata
 */
const phoneNumbersMetadata = [
    {
        id: 'PN_TEST_001',
        name: 'Sales Line',
        users: [
            {
                id: 'US_TEST_001',
                role: 'owner',
                email: 'sales@example.com',
                groupId: 'GR_TEST_001',
                lastName: 'Smith',
                firstName: 'John',
            },
        ],
        number: '+15551234567', // Quo phone number (internal)
        symbol: '📞',
        forward: null,
        groupId: 'GR_TEST_001',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        restrictions: {
            calling: {
                CA: 'unrestricted',
                US: 'unrestricted',
                Intl: 'restricted',
            },
            messaging: {
                CA: 'unrestricted',
                US: 'restricted',
                Intl: 'restricted',
            },
        },
        portRequestId: null,
        portingStatus: null,
        formattedNumber: '(555) 123-4567',
    },
];

/**
 * call.recording.completed webhook
 * Sent when a call recording is available
 */
const callRecordingCompletedWebhook = {
    apiVersion: 'v4',
    createdAt: '2025-01-15T10:30:45.675Z',
    data: {
        deepLink: 'https://my.quo.com/inbox/PN_TEST_001/c/CN_TEST_001?at=AC_TEST_001',
        object: {
            answeredAt: '2025-01-15T10:29:30.000Z',
            answeredBy: 'SY_TEST_001',
            completedAt: '2025-01-15T10:30:44.000Z',
            contactIds: ['CONT_TEST_001'],
            createdAt: '2025-01-15T10:29:28.110Z',
            direction: 'incoming',
            duration: 76,
            forwardedFrom: null,
            forwardedTo: null,
            id: 'AC_TEST_001',
            initiatedBy: null,
            object: 'call',
            participants: ['+15559876543', '+15551234567'], // [contact, quo_phone]
            phoneNumberId: 'PN_TEST_001',
            recordings: [
                {
                    duration: 72,
                    id: 'CR_TEST_001',
                    startTime: '2025-01-15T10:29:30.000Z',
                    type: 'audio/mpeg',
                    url: 'https://storage.example.com/recordings/test-001.mp3',
                },
            ],
            status: 'completed',
            updatedAt: '2025-01-15T10:30:44.522Z',
            userId: 'US_TEST_001',
        },
    },
    id: 'WH_TEST_001',
    object: 'event',
    type: 'call.recording.completed',
};

/**
 * call.summary.completed webhook
 * Sent when AI call summary is generated
 */
const callSummaryCompletedWebhook = {
    apiVersion: 'v4',
    createdAt: '2025-01-15T10:30:46.350Z',
    data: {
        deepLink: 'https://my.quo.com/inbox/PN_TEST_001/c/CN_TEST_001?at=AC_TEST_001',
        object: {
            callId: 'AC_TEST_001', // Note: different from call webhooks (data.object.id)
            jobs: [
                {
                    icon: '✍️',
                    name: 'Message taking',
                    result: {
                        data: [
                            {
                                name: 'First and last name',
                                value: 'Jane Doe',
                            },
                            {
                                name: 'Summarize the message',
                                value: 'Jane Doe called to inquire about product pricing. She is interested in the enterprise plan and would like a callback to discuss details.',
                            },
                        ],
                    },
                },
            ],
            nextSteps: [],
            object: 'callSummary',
            status: 'completed',
            summary: [
                'The caller, Jane Doe, inquired about enterprise pricing plans. The AI assistant collected her name and confirmed that someone would follow up regarding pricing details.',
            ],
        },
    },
    id: 'WH_TEST_002',
    object: 'event',
    type: 'call.summary.completed',
};

/**
 * call.completed webhook
 * Sent when a call finishes
 */
const callCompletedWebhook = {
    apiVersion: 'v4',
    createdAt: '2025-01-15T10:30:44.097Z',
    data: {
        deepLink: 'https://my.quo.com/inbox/PN_TEST_001/c/CN_TEST_001?at=AC_TEST_001',
        object: {
            answeredAt: '2025-01-15T10:29:30.000Z',
            answeredBy: 'SY_TEST_001',
            completedAt: '2025-01-15T10:30:44.000Z',
            contactIds: ['CONT_TEST_001'],
            createdAt: '2025-01-15T10:29:28.110Z',
            direction: 'incoming',
            duration: 76,
            forwardedFrom: null,
            forwardedTo: null,
            id: 'AC_TEST_001',
            initiatedBy: null,
            object: 'call',
            participants: ['+15559876543', '+15551234567'], // [contact, quo_phone]
            phoneNumberId: 'PN_TEST_001',
            recordings: null, // Not yet available at call.completed
            status: 'completed',
            updatedAt: '2025-01-15T10:30:44.522Z',
            userId: 'US_TEST_001',
        },
    },
    id: 'WH_TEST_003',
    object: 'event',
    type: 'call.completed',
};

/**
 * message.delivered webhook
 * Sent when an outgoing message is delivered
 */
const messageDeliveredWebhook = {
    apiVersion: 'v4',
    createdAt: '2025-01-15T10:25:10.736Z',
    data: {
        deepLink: 'https://quo.com/inbox/PN_TEST_001/c/CN_TEST_002?at=AC_TEST_002',
        object: {
            contactIds: [
                'CONT_TEST_002',
                'CONT_TEST_003',
                'CONT_TEST_004',
            ],
            createdAt: '2025-01-15T10:25:08.771Z',
            direction: 'outgoing',
            from: '+15551234567', // Quo phone (outgoing FROM)
            id: 'MSG_TEST_001',
            object: 'message',
            phoneNumberId: 'PN_TEST_001',
            status: 'delivered',
            text: 'Thank you for your inquiry. We will get back to you shortly.',
            to: '+15559876543', // Contact phone (outgoing TO)
            userId: 'US_TEST_001',
        },
    },
    id: 'WH_TEST_004',
    object: 'event',
    type: 'message.delivered',
};

/**
 * call.completed webhook with EMPTY participants array
 * Real v4 API bug - some webhooks arrive with empty participants
 */
const callCompletedEmptyParticipants = {
    apiVersion: 'v4',
    createdAt: '2025-01-15T11:00:15.000Z',
    data: {
        deepLink: 'https://quo.com/inbox/PN_TEST_002/c/CN_TEST_003?at=AC_TEST_EMPTY',
        object: {
            id: 'AC_TEST_EMPTY',
            direction: 'incoming',
            status: 'no-answer',
            duration: 16,
            participants: [], // EMPTY - this is the bug
            phoneNumberId: 'PN_TEST_002',
            userId: 'US_TEST_002',
            createdAt: '2025-01-15T11:00:01.758Z',
            answeredAt: null,
            answeredBy: null,
            completedAt: '2025-01-15T11:00:16.000Z',
            contactIds: [],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: null,
            object: 'call',
            recordings: null,
            updatedAt: '2025-01-15T11:00:16.000Z',
        },
    },
    id: 'WH_TEST_EMPTY',
    object: 'event',
    type: 'call.completed',
};

/**
 * Full call details response (from getCall API)
 * Used as fallback when participants array is empty
 */
const fullCallDetails = {
    data: {
        id: 'AC_TEST_EMPTY',
        from: '+15557654321', // Contact phone (incoming FROM)
        to: '+15552468135', // Quo phone (incoming TO)
        direction: 'incoming',
        status: 'no-answer',
        duration: 16,
        phoneNumberId: 'PN_TEST_002',
        userId: 'US_TEST_002',
        answeredAt: null,
        completedAt: '2025-01-15T11:00:16.000Z',
        createdAt: '2025-01-15T11:00:01.758Z',
        updatedAt: '2025-01-15T11:00:16.000Z',
    },
};

module.exports = {
    phoneNumbersMetadata,
    callRecordingCompletedWebhook,
    callSummaryCompletedWebhook,
    callCompletedWebhook,
    messageDeliveredWebhook,
    callCompletedEmptyParticipants,
    fullCallDetails,
};
