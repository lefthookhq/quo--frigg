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
 * Filter external contact phone from participants array
 *
 * @param {Array<string>} participants - Participant phone numbers from webhook
 * @param {Array} phoneNumbersMetadata - Integration config phoneNumbersMetadata
 * @returns {string|null} External contact phone number, or null if not found
 *
 * @example
 * const participants = ['+15559876543', '+15551234567'];
 * const metadata = [{ number: '+15551234567', name: 'Sales Line' }];
 * const contactPhone = filterExternalParticipant(participants, metadata);
 * // Returns: '+15559876543'
 */
function filterExternalParticipant(participants, phoneNumbersMetadata) {
    if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return null;
    }

    // Extract Quo phone numbers from metadata
    const quoNumbers = extractQuoPhoneNumbers(phoneNumbersMetadata);

    // If no metadata, fall back to legacy behavior (first participant)
    if (quoNumbers.size === 0) {
        console.warn('[ParticipantFilter] No phoneNumbersMetadata available, using first participant');
        return participants[0] || null;
    }

    // Find first participant that is NOT a Quo number
    for (const participant of participants) {
        const normalized = normalizePhoneNumber(participant);
        if (!quoNumbers.has(normalized)) {
            console.log(`[ParticipantFilter] Found external participant: ${participant}`);
            return participant;
        }
    }

    // All participants are Quo numbers (edge case)
    console.warn('[ParticipantFilter] All participants are Quo numbers, returning null');
    return null;
}

/**
 * Get contact phone from call webhook data
 * Handles both normal participants array and empty participants fallback
 *
 * Note: Quo v4 API uses participants[] array, not from/to fields.
 * When participants is empty (bug), fullCallData also only has participants.
 *
 * @param {Object} callObject - Call object from webhook data.object
 * @param {Object} fullCallData - Optional full call data from getCall() API (when participants is empty)
 * @param {Array} phoneNumbersMetadata - Integration config phoneNumbersMetadata
 * @returns {string|null} Contact phone number
 */
function getContactPhoneFromCall(callObject, fullCallData, phoneNumbersMetadata) {
    let participants = callObject.participants || [];

    // Case 1: Normal participants array with values
    if (participants.length > 0) {
        return filterExternalParticipant(participants, phoneNumbersMetadata);
    }

    // Case 2: Empty participants array - use fullCallData.participants
    if (fullCallData && fullCallData.participants && fullCallData.participants.length > 0) {
        console.log('[ParticipantFilter] Using fullCallData.participants fallback (empty participants in webhook)');
        return filterExternalParticipant(fullCallData.participants, phoneNumbersMetadata);
    }

    // Case 3: No participants anywhere (should be very rare)
    console.warn('[ParticipantFilter] No participants found in webhook or fullCallData');
    return null;
}

module.exports = {
    normalizePhoneNumber,
    extractQuoPhoneNumbers,
    filterExternalParticipant,
    getContactPhoneFromCall,
};
