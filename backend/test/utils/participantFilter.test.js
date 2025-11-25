/**
 * Participant Filter Utility Tests
 *
 * TDD tests for filtering Quo phone numbers from participants array
 */

const {
    normalizePhoneNumber,
    extractQuoPhoneNumbers,
    filterExternalParticipant,
    getContactPhoneFromCall,
} = require('../../src/utils/participantFilter');

const { phoneNumbersMetadata } = require('../fixtures/quo-v4-webhooks');

describe('ParticipantFilter Utility', () => {
    describe('normalizePhoneNumber', () => {
        it('should remove spaces, dashes, and parentheses', () => {
            expect(normalizePhoneNumber('(555) 123-4567')).toBe('5551234567');
            expect(normalizePhoneNumber('+1 555 123 4567')).toBe('+15551234567');
            expect(normalizePhoneNumber('+1-555-123-4567')).toBe('+15551234567');
        });

        it('should preserve + for E.164 format', () => {
            expect(normalizePhoneNumber('+15551234567')).toBe('+15551234567');
        });

        it('should handle null and non-string inputs', () => {
            expect(normalizePhoneNumber(null)).toBe(null);
            expect(normalizePhoneNumber(undefined)).toBe(undefined);
            expect(normalizePhoneNumber(123)).toBe(123);
        });
    });

    describe('extractQuoPhoneNumbers', () => {
        it('should extract phone numbers from metadata', () => {
            const metadata = [
                { number: '+15551234567', name: 'Sales' },
                { number: '+15559876543', name: 'Support' },
            ];

            const quoNumbers = extractQuoPhoneNumbers(metadata);

            expect(quoNumbers.size).toBe(2);
            expect(quoNumbers.has('+15551234567')).toBe(true);
            expect(quoNumbers.has('+15559876543')).toBe(true);
        });

        it('should normalize numbers during extraction', () => {
            const metadata = [
                { number: '(555) 123-4567', name: 'Sales' },
            ];

            const quoNumbers = extractQuoPhoneNumbers(metadata);

            expect(quoNumbers.has('5551234567')).toBe(true);
            expect(quoNumbers.has('(555) 123-4567')).toBe(false); // Not normalized version
        });

        it('should handle empty or invalid metadata', () => {
            expect(extractQuoPhoneNumbers(null).size).toBe(0);
            expect(extractQuoPhoneNumbers(undefined).size).toBe(0);
            expect(extractQuoPhoneNumbers([]).size).toBe(0);
        });

        it('should extract both number and formattedNumber', () => {
            const metadata = [
                {
                    number: '+15551234567',
                    formattedNumber: '(555) 123-4567',
                },
            ];

            const quoNumbers = extractQuoPhoneNumbers(metadata);

            // Both normalized forms should be present
            expect(quoNumbers.has('+15551234567')).toBe(true);
            expect(quoNumbers.has('5551234567')).toBe(true);
        });
    });

    describe('filterExternalParticipant', () => {
        it('should filter out Quo phone and return external contact', () => {
            const participants = ['+15559876543', '+15551234567'];
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = filterExternalParticipant(participants, metadata);

            expect(contactPhone).toBe('+15559876543');
        });

        it('should work regardless of participant order', () => {
            const participants = ['+15551234567', '+15559876543']; // Quo first
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = filterExternalParticipant(participants, metadata);

            expect(contactPhone).toBe('+15559876543');
        });

        it('should handle multiple Quo numbers in metadata', () => {
            const participants = ['+15557654321', '+15551234567', '+15559876543'];
            const metadata = [
                { number: '+15551234567', name: 'Sales' },
                { number: '+15559876543', name: 'Support' },
            ];

            const contactPhone = filterExternalParticipant(participants, metadata);

            // Should return the first non-Quo number
            expect(contactPhone).toBe('+15557654321');
        });

        it('should fallback to first participant when no metadata', () => {
            const participants = ['+15559876543', '+15551234567'];
            const metadata = [];

            const contactPhone = filterExternalParticipant(participants, metadata);

            expect(contactPhone).toBe('+15559876543');
        });

        it('should handle empty participants array', () => {
            const participants = [];
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = filterExternalParticipant(participants, metadata);

            expect(contactPhone).toBe(null);
        });

        it('should return null when all participants are Quo numbers', () => {
            const participants = ['+15551234567', '+15559876543'];
            const metadata = [
                { number: '+15551234567', name: 'Sales' },
                { number: '+15559876543', name: 'Support' },
            ];

            const contactPhone = filterExternalParticipant(participants, metadata);

            expect(contactPhone).toBe(null);
        });
    });

    describe('getContactPhoneFromCall', () => {
        it('should use participants array when available', () => {
            const callObject = {
                id: 'AC_TEST_001',
                direction: 'incoming',
                participants: ['+15559876543', '+15551234567'],
            };
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = getContactPhoneFromCall(callObject, null, metadata);

            expect(contactPhone).toBe('+15559876543');
        });

        it('should fallback to fullCallData when participants empty (incoming)', () => {
            const callObject = {
                id: 'AC_TEST_EMPTY',
                direction: 'incoming',
                participants: [],
            };
            const fullCallData = {
                participants: ['+15557654321', '+15551234567'], // [contact, quo] for incoming
            };
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = getContactPhoneFromCall(callObject, fullCallData, metadata);

            expect(contactPhone).toBe('+15557654321');
        });

        it('should fallback to fullCallData when participants empty (outgoing)', () => {
            const callObject = {
                id: 'AC_TEST_EMPTY',
                direction: 'outgoing',
                participants: [],
            };
            const fullCallData = {
                participants: ['+15551234567', '+15557654321'], // [quo, contact] for outgoing
            };
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = getContactPhoneFromCall(callObject, fullCallData, metadata);

            expect(contactPhone).toBe('+15557654321');
        });

        it('should return null when no participants and no fullCallData', () => {
            const callObject = {
                id: 'AC_TEST_NONE',
                direction: 'incoming',
                participants: [],
            };
            const metadata = [{ number: '+15551234567', name: 'Sales' }];

            const contactPhone = getContactPhoneFromCall(callObject, null, metadata);

            expect(contactPhone).toBe(null);
        });

        it('should work with real phoneNumbersMetadata fixture', () => {
            const callObject = {
                id: 'AC_TEST_001',
                direction: 'incoming',
                participants: ['+15559876543', '+15551234567'],
            };

            const contactPhone = getContactPhoneFromCall(callObject, null, phoneNumbersMetadata);

            expect(contactPhone).toBe('+15559876543');
        });
    });
});
