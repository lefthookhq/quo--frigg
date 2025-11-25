/**
 * Participant Filter Utility
 *
 * Filters Quo phone numbers from participants array using phoneNumbersMetadata
 * to identify the external contact phone number.
 *
 * Context: Quo v4 API webhooks include a participants[] array with both the
 * Quo phone number (internal) and the contact phone number (external).
 * We need to filter out the Quo number to find the contact.
 */

/**
 * Normalize phone number for comparison
 * Removes spaces, dashes, parentheses but keeps + for E.164 format
 *
 * @param {string} phone - Phone number to normalize
 * @returns {string} Normalized phone number
 */
function normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return phone;
    return phone.replace(/[\s\(\)\-]/g, '');
}

/**
 * Extract Quo phone numbers from metadata
 *
 * @param {Array} phoneNumbersMetadata - Integration config phoneNumbersMetadata
 * @returns {Set<string>} Set of normalized Quo phone numbers
 */
function extractQuoPhoneNumbers(phoneNumbersMetadata) {
    const quoNumbers = new Set();

    if (!phoneNumbersMetadata || !Array.isArray(phoneNumbersMetadata)) {
        return quoNumbers;
    }

    for (const metadata of phoneNumbersMetadata) {
        if (metadata.number) {
            quoNumbers.add(normalizePhoneNumber(metadata.number));
        }
        if (metadata.formattedNumber) {
            quoNumbers.add(normalizePhoneNumber(metadata.formattedNumber));
        }
    }

    return quoNumbers;
}

/**
 * Filter ALL external contact phones from participants array
 * Supports multi-party calls (3-way calls, conference calls, etc.)
 *
 * @param {Array<string>} participants - Participant phone numbers from webhook
 * @param {Array} phoneNumbersMetadata - Integration config phoneNumbersMetadata
 * @returns {Array<string>} Array of external contact phone numbers (may be empty)
 *
 * @example
 * // 3-way call: 2 external contacts + 1 Quo number
 * const participants = ['+15559876543', '+15551234567', '+15559998888'];
 * const metadata = [{ number: '+15551234567', name: 'Sales Line' }];
 * const externalPhones = filterExternalParticipants(participants, metadata);
 * // Returns: ['+15559876543', '+15559998888']
 */
function filterExternalParticipants(participants, phoneNumbersMetadata) {
    if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return [];
    }

    const quoNumbers = extractQuoPhoneNumbers(phoneNumbersMetadata);

    if (quoNumbers.size === 0) {
        console.warn('[ParticipantFilter] No phoneNumbersMetadata available, returning all participants');
        return [...participants];
    }

    const externalParticipants = participants.filter(participant => {
        const normalized = normalizePhoneNumber(participant);
        return !quoNumbers.has(normalized);
    });

    console.log(`[ParticipantFilter] Found ${externalParticipants.length} external participant(s): ${externalParticipants.join(', ')}`);
    return externalParticipants;
}

module.exports = {
    normalizePhoneNumber,
    extractQuoPhoneNumbers,
    filterExternalParticipants,
};
