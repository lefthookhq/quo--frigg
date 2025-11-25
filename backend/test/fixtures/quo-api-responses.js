/**
 * Quo API Response Mock Fixtures
 *
 * Centralized mock responses for all Quo API endpoints.
 * Use these instead of inline mocking for consistency and maintainability.
 *
 * Usage:
 *   const { mockGetCall, mockGetPhoneNumber } = require('./fixtures/quo-api-responses');
 *   mockQuoApi.api.getCall.mockResolvedValue(mockGetCall.completed);
 */

// ============================================================================
// PHONE NUMBER RESPONSES (getPhoneNumber)
// ============================================================================

const mockGetPhoneNumber = {
    // Primary sales line
    salesLine: {
        data: {
            id: 'PN_TEST_001',
            name: 'Sales Line',
            symbol: '📞',
            number: '+15551234567',
            formattedNumber: '(555) 123-4567',
            groupId: 'GR_TEST_001',
            users: [
                {
                    id: 'US_TEST_001',
                    role: 'owner',
                    email: 'sales@example.com',
                },
            ],
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        },
    },

    // Support line
    supportLine: {
        data: {
            id: 'PN_TEST_002',
            name: 'Support Line',
            symbol: '🛠️',
            number: '+15552468135',
            formattedNumber: '(555) 246-8135',
            groupId: 'GR_TEST_002',
            users: [],
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
        },
    },

    // Minimal response
    minimal: {
        data: {
            id: 'PN_MINIMAL',
            name: 'Main Line',
            number: '+15559999999',
        },
    },
};

// ============================================================================
// USER RESPONSES (getUser)
// ============================================================================

const mockGetUser = {
    // John Smith (sales rep)
    johnSmith: {
        data: {
            id: 'US_TEST_001',
            firstName: 'John',
            lastName: 'Smith',
            email: 'john.smith@example.com',
            role: 'admin',
            phoneNumberIds: ['PN_TEST_001'],
        },
    },

    // Jane Doe (support rep)
    janeDoe: {
        data: {
            id: 'US_TEST_002',
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane.doe@example.com',
            role: 'member',
            phoneNumberIds: ['PN_TEST_002'],
        },
    },

    // Minimal response
    minimal: {
        data: {
            id: 'US_MINIMAL',
            firstName: 'Test',
            lastName: 'User',
        },
    },

    // No name (edge case)
    noName: {
        data: {
            id: 'US_NO_NAME',
            email: 'noname@example.com',
        },
    },
};

// ============================================================================
// CALL RESPONSES (getCall)
// ============================================================================

const mockGetCall = {
    // Completed incoming call with recording
    completedIncoming: {
        data: {
            id: 'AC_TEST_001',
            participants: ['+15559876543', '+15551234567'], // [contact, quo_phone] for incoming
            direction: 'incoming',
            status: 'completed',
            duration: 76,
            phoneNumberId: 'PN_TEST_001',
            userId: 'US_TEST_001',
            answeredAt: '2025-01-15T10:29:30.000Z',
            answeredBy: 'US_TEST_001',
            completedAt: '2025-01-15T10:30:44.000Z',
            createdAt: '2025-01-15T10:29:28.110Z',
            updatedAt: '2025-01-15T10:30:44.522Z',
            contactIds: ['CONT_TEST_001'],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: null,
            aiHandled: null,
            callRoute: 'phone-number',
        },
    },

    // Completed outgoing call
    completedOutgoing: {
        data: {
            id: 'AC_TEST_002',
            participants: ['+15551234567', '+15559876543'], // [quo_phone, contact] for outgoing
            direction: 'outgoing',
            status: 'completed',
            duration: 120,
            phoneNumberId: 'PN_TEST_001',
            userId: 'US_TEST_001',
            answeredAt: '2025-01-15T11:00:05.000Z',
            answeredBy: null,
            completedAt: '2025-01-15T11:02:05.000Z',
            createdAt: '2025-01-15T11:00:00.000Z',
            updatedAt: '2025-01-15T11:02:05.000Z',
            contactIds: ['CONT_TEST_001'],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: 'US_TEST_001',
            aiHandled: null,
            callRoute: 'phone-number',
        },
    },

    // Missed call (no-answer)
    missedCall: {
        data: {
            id: 'AC_TEST_MISSED',
            participants: ['+15559876543', '+15551234567'],
            direction: 'incoming',
            status: 'no-answer',
            duration: 16,
            phoneNumberId: 'PN_TEST_001',
            userId: 'US_TEST_001',
            answeredAt: null,
            answeredBy: null,
            completedAt: '2025-01-15T12:00:16.000Z',
            createdAt: '2025-01-15T12:00:00.000Z',
            updatedAt: '2025-01-15T12:00:16.000Z',
            contactIds: [],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: null,
            aiHandled: null,
            callRoute: 'phone-number',
        },
    },

    // Voicemail call
    voicemailCall: {
        data: {
            id: 'AC_TEST_VOICEMAIL',
            participants: ['+15559876543', '+15551234567'],
            direction: 'incoming',
            status: 'completed',
            duration: 45,
            phoneNumberId: 'PN_TEST_001',
            userId: 'US_TEST_001',
            answeredAt: '2025-01-15T13:00:05.000Z',
            answeredBy: 'US_TEST_001',
            completedAt: '2025-01-15T13:00:50.000Z',
            createdAt: '2025-01-15T13:00:00.000Z',
            updatedAt: '2025-01-15T13:00:50.000Z',
            contactIds: ['CONT_TEST_001'],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: null,
            aiHandled: null,
            callRoute: 'phone-number',
        },
    },

    // Call with empty participants (edge case - shouldn't happen but does)
    emptyParticipants: {
        data: {
            id: 'AC_TEST_EMPTY',
            participants: [], // Empty array - the bug case
            direction: 'incoming',
            status: 'no-answer',
            duration: 16,
            phoneNumberId: 'PN_TEST_002',
            userId: 'US_TEST_002',
            answeredAt: null,
            answeredBy: null,
            completedAt: '2025-01-15T11:00:16.000Z',
            createdAt: '2025-01-15T11:00:01.758Z',
            updatedAt: '2025-01-15T11:00:16.000Z',
            contactIds: [],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: null,
            aiHandled: null,
            callRoute: 'phone-number',
        },
    },

    // AI-handled call (e.g., Sona AI)
    aiHandledCall: {
        data: {
            id: 'AC_TEST_AI',
            participants: ['+15559876543', '+15551234567'],
            direction: 'incoming',
            status: 'completed',
            duration: 95,
            phoneNumberId: 'PN_TEST_001',
            userId: 'US_TEST_001',
            answeredAt: '2025-01-15T14:00:00.000Z',
            answeredBy: 'SY_AI_AGENT_001', // AI system ID, not user ID
            completedAt: '2025-01-15T14:01:35.000Z',
            createdAt: '2025-01-15T13:59:58.000Z',
            updatedAt: '2025-01-15T14:01:35.000Z',
            contactIds: ['CONT_TEST_001'],
            forwardedFrom: null,
            forwardedTo: null,
            initiatedBy: null,
            aiHandled: 'ai-agent', // Indicates AI handled the call
            callRoute: 'phone-number',
        },
    },
};

// ============================================================================
// RECORDING RESPONSES (getCallRecordings)
// ============================================================================

const mockGetCallRecordings = {
    // Single recording
    singleRecording: {
        data: [
            {
                id: 'CR_TEST_001',
                duration: 72,
                startTime: '2025-01-15T10:29:30.000Z',
                type: 'audio/mpeg',
                url: 'https://storage.example.com/recordings/test-001.mp3',
            },
        ],
    },

    // Multiple recordings (conference call or merged segments)
    multipleRecordings: {
        data: [
            {
                id: 'CR_TEST_001',
                duration: 45,
                startTime: '2025-01-15T10:29:30.000Z',
                type: 'audio/mpeg',
                url: 'https://storage.example.com/recordings/part1.mp3',
            },
            {
                id: 'CR_TEST_002',
                duration: 30,
                startTime: '2025-01-15T10:30:15.000Z',
                type: 'audio/mpeg',
                url: 'https://storage.example.com/recordings/part2.mp3',
            },
        ],
    },

    // No recordings yet
    noRecordings: {
        data: [],
    },

    // Recording without URL (processing)
    processingRecording: {
        data: [
            {
                id: 'CR_PROCESSING',
                duration: 60,
                startTime: '2025-01-15T10:29:30.000Z',
                type: 'audio/mpeg',
                url: null, // Still processing
            },
        ],
    },
};

// ============================================================================
// VOICEMAIL RESPONSES (getCallVoicemails)
// ============================================================================

const mockGetCallVoicemails = {
    // Standard voicemail
    standard: {
        data: {
            id: 'VM_TEST_001',
            duration: 35,
            url: 'https://storage.example.com/voicemails/vm-001.mp3',
            transcription: 'Hi, this is John calling about the meeting.',
            createdAt: '2025-01-15T14:00:35.000Z',
        },
    },

    // Long voicemail
    long: {
        data: {
            id: 'VM_TEST_002',
            duration: 180, // 3 minutes
            url: 'https://storage.example.com/voicemails/vm-002.mp3',
            transcription: 'This is a very long voicemail message...',
            createdAt: '2025-01-15T14:05:00.000Z',
        },
    },

    // No voicemail
    none: {
        data: null,
    },
};

// ============================================================================
// CONTACT RESPONSES (getContact, listContacts)
// ============================================================================

const mockGetContact = {
    // Standard contact
    standard: {
        data: {
            id: 'CONT_TEST_001',
            externalId: 'ext-123',
            source: 'public-api',
            defaultFields: {
                firstName: 'Jane',
                lastName: 'Doe',
                company: 'Acme Corp',
                emails: [
                    {
                        name: 'work',
                        value: 'jane.doe@acme.com',
                    },
                ],
                phoneNumbers: [
                    {
                        name: 'mobile',
                        value: '+15559876543',
                    },
                ],
            },
            customFields: [],
            createdAt: '2025-01-10T00:00:00.000Z',
            updatedAt: '2025-01-15T00:00:00.000Z',
        },
    },

    // Minimal contact
    minimal: {
        data: {
            id: 'CONT_MINIMAL',
            defaultFields: {
                firstName: 'Test',
                phoneNumbers: [
                    {
                        name: 'mobile',
                        value: '+15551111111',
                    },
                ],
            },
        },
    },
};

// ============================================================================
// HELPER FUNCTIONS FOR TEST SETUP
// ============================================================================

/**
 * Setup standard Quo API mocks for common test scenarios
 *
 * @param {Object} mockQuoApi - Mock Quo API object
 * @param {string} scenario - Scenario name: 'incoming', 'outgoing', 'missed', 'voicemail'
 * @returns {void}
 */
function setupStandardQuoMocks(mockQuoApi, scenario = 'incoming') {
    const scenarios = {
        incoming: {
            getCall: mockGetCall.completedIncoming,
            getPhoneNumber: mockGetPhoneNumber.salesLine,
            getUser: mockGetUser.johnSmith,
        },
        outgoing: {
            getCall: mockGetCall.completedOutgoing,
            getPhoneNumber: mockGetPhoneNumber.salesLine,
            getUser: mockGetUser.johnSmith,
        },
        missed: {
            getCall: mockGetCall.missedCall,
            getPhoneNumber: mockGetPhoneNumber.salesLine,
            getUser: mockGetUser.johnSmith,
        },
        voicemail: {
            getCall: mockGetCall.voicemailCall,
            getPhoneNumber: mockGetPhoneNumber.salesLine,
            getUser: mockGetUser.johnSmith,
            getCallVoicemails: mockGetCallVoicemails.standard,
        },
    };

    const config = scenarios[scenario];

    if (config.getCall) {
        mockQuoApi.api.getCall.mockResolvedValue(config.getCall);
    }
    if (config.getPhoneNumber) {
        mockQuoApi.api.getPhoneNumber.mockResolvedValue(config.getPhoneNumber);
    }
    if (config.getUser) {
        mockQuoApi.api.getUser.mockResolvedValue(config.getUser);
    }
    if (config.getCallVoicemails) {
        mockQuoApi.api.getCallVoicemails.mockResolvedValue(config.getCallVoicemails);
    }
}

module.exports = {
    // Response mocks
    mockGetPhoneNumber,
    mockGetUser,
    mockGetCall,
    mockGetCallRecordings,
    mockGetCallVoicemails,
    mockGetContact,

    // Helper functions
    setupStandardQuoMocks,
};
