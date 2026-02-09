const { filterExternalParticipants } = require('../../utils/participantFilter');
const QuoCallContentBuilder = require('./QuoCallContentBuilder');

/**
 * QuoWebhookEventProcessor
 *
 * Orchestrates the processing of Quo webhook events (calls, messages).
 * Handles the common flow while delegating CRM-specific operations to adapters.
 *
 * @class
 */
class QuoWebhookEventProcessor {
    /**
     * Process a call.completed webhook event
     *
     * @param {Object} params
     * @param {Object} params.webhookData - Raw Quo webhook payload
     * @param {Object} params.quoApi - Quo API client
     * @param {Array} params.phoneNumbersMetadata - Integration config for phone filtering
     * @param {Object} params.crmAdapter - CRM-specific operations
     * @param {string} params.crmAdapter.formatMethod - 'markdown', 'html', or 'plainText'
     * @param {Function} params.crmAdapter.findContactByPhone - (phone) => Promise<contactId|null>
     * @param {Function} params.crmAdapter.createCallActivity - (contactId, activity) => Promise<activityId>
     * @param {Object} params.mappingRepo - Mapping repository { get, upsert }
     * @param {Function} [params.onActivityCreated] - Optional callback after activity created
     * @returns {Promise<Object>} Processing result
     */
    static async processCallEvent({
        webhookData,
        quoApi,
        phoneNumbersMetadata,
        crmAdapter,
        mappingRepo,
        onActivityCreated,
    }) {
        const callId = webhookData.data.object.id;
        const formatOptions = QuoCallContentBuilder.getFormatOptions(
            crmAdapter.formatMethod,
        );
        const useEmoji = crmAdapter.useEmoji !== false;

        console.log(`[QuoEventProcessor] Processing call.completed: ${callId}`);

        const call = await this.fetchCallWithVoicemail(quoApi, callId);
        if (!call) {
            console.warn(`[QuoEventProcessor] Call ${callId} not found`);
            return { logged: false, error: 'Call not found', callId };
        }

        const externalParticipants = filterExternalParticipants(
            call.participants || [],
            phoneNumbersMetadata,
        );

        if (externalParticipants.length === 0) {
            console.warn(
                `[QuoEventProcessor] No external participants found for call ${callId}`,
            );
            return {
                logged: false,
                callId,
                error: 'No external participants',
                participantCount: 0,
            };
        }

        console.log(
            `[QuoEventProcessor] Found ${externalParticipants.length} external participant(s)`,
        );

        // Use answeredBy (the user who answered) if available, otherwise fall back to userId (phone owner)
        const userIdForDisplay = call.answeredBy || call.userId;
        const { inboxName, inboxNumber, userName } =
            await this.fetchCallMetadata(
                quoApi,
                call.phoneNumberId,
                userIdForDisplay,
            );

        const deepLink = webhookData.data.deepLink || '#';

        const results = [];
        for (const contactPhone of externalParticipants) {
            try {
                const contactId =
                    await crmAdapter.findContactByPhone(contactPhone);

                if (!contactId) {
                    console.log(
                        `[QuoEventProcessor] No contact found for phone ${contactPhone}`,
                    );
                    results.push({
                        contactPhone,
                        logged: false,
                        error: 'Contact not found',
                    });
                    continue;
                }

                const title = QuoCallContentBuilder.buildCallTitle({
                    call,
                    inboxName,
                    inboxNumber,
                    contactPhone,
                    formatOptions,
                    useEmoji,
                });

                const content = QuoCallContentBuilder.buildCallContent({
                    call,
                    userName,
                    deepLink,
                    formatOptions,
                });

                const activityId = await crmAdapter.createCallActivity(
                    contactId,
                    {
                        title,
                        content,
                        timestamp: call.createdAt,
                        duration: call.duration,
                        direction: call.direction,
                        durationFormatted:
                            formatOptions.formatMethod === 'plainText'
                                ? this._formatDurationForZoho(call.duration)
                                : undefined,
                    },
                );

                if (activityId) {
                    await mappingRepo.upsert(callId, {
                        noteId: activityId,
                        callId,
                        contactId,
                        createdAt: new Date().toISOString(),
                    });

                    console.log(
                        `[QuoEventProcessor] ✓ Logged call for ${contactPhone}, activity: ${activityId}`,
                    );

                    if (onActivityCreated) {
                        await onActivityCreated({
                            callId,
                            contactId,
                            contactPhone,
                            activityId,
                        });
                    }
                }

                results.push({
                    contactPhone,
                    contactId,
                    activityId,
                    logged: !!activityId,
                });
            } catch (error) {
                console.error(
                    `[QuoEventProcessor] Error processing participant ${contactPhone}:`,
                    error.message,
                );
                results.push({
                    contactPhone,
                    logged: false,
                    error: error.message,
                });
            }
        }

        return {
            logged: results.some((r) => r.logged),
            callId,
            participantCount: externalParticipants.length,
            results,
        };
    }

    /**
     * Process a message.received or message.delivered webhook event
     *
     * @param {Object} params
     * @param {Object} params.webhookData - Raw Quo webhook payload
     * @param {Object} params.quoApi - Quo API client
     * @param {Object} params.crmAdapter - CRM-specific operations
     * @param {string} params.crmAdapter.formatMethod - 'markdown', 'html', or 'plainText'
     * @param {Function} params.crmAdapter.findContactByPhone - (phone) => Promise<contactId|null>
     * @param {Function} params.crmAdapter.createMessageActivity - (contactId, activity) => Promise<activityId>
     * @param {Object} params.mappingRepo - Mapping repository { get, upsert }
     * @param {Function} [params.onActivityCreated] - Optional callback after activity created
     * @returns {Promise<Object>} Processing result
     */
    static async processMessageEvent({
        webhookData,
        quoApi,
        crmAdapter,
        mappingRepo,
        onActivityCreated,
    }) {
        const messageObject = webhookData.data.object;
        const messageId = messageObject.id;
        const eventType = webhookData.type;
        const formatOptions = QuoCallContentBuilder.getFormatOptions(
            crmAdapter.formatMethod,
        );
        const useEmoji = crmAdapter.useEmoji !== false;

        console.log(
            `[QuoEventProcessor] Processing message: ${messageId} (${eventType})`,
        );

        const existingMapping = await mappingRepo.get(messageId);
        const existingNoteId =
            existingMapping?.mapping?.noteId || existingMapping?.noteId || null;

        if (existingNoteId) {
            console.log(
                `[QuoEventProcessor] Message ${messageId} already logged (note: ${existingNoteId}), skipping`,
            );
            return {
                logged: false,
                skipped: true,
                reason: 'duplicate',
                messageId,
                noteId: existingNoteId,
            };
        }

        const contactPhone =
            messageObject.direction === 'outgoing'
                ? messageObject.to
                : messageObject.from;

        console.log(
            `[QuoEventProcessor] Message direction: ${messageObject.direction}, contact: ${contactPhone}`,
        );

        const contactId = await crmAdapter.findContactByPhone(contactPhone);
        if (!contactId) {
            console.log(
                `[QuoEventProcessor] No contact found for phone ${contactPhone}`,
            );
            return {
                logged: false,
                messageId,
                error: 'Contact not found',
                contactPhone,
            };
        }

        const phoneNumberDetails = await quoApi.getPhoneNumber(
            messageObject.phoneNumberId,
        );
        const userDetails = await quoApi.getUser(messageObject.userId);

        const inboxName = QuoCallContentBuilder.buildInboxName(
            phoneNumberDetails,
            'Quo Inbox',
        );
        const inboxNumber =
            messageObject.direction === 'outgoing'
                ? messageObject.from
                : messageObject.to;
        const userName = QuoCallContentBuilder.buildUserName(userDetails);
        const deepLink = webhookData.data.deepLink || '#';

        const title = QuoCallContentBuilder.buildMessageTitle({
            message: messageObject,
            inboxName,
            inboxNumber,
            contactPhone,
            formatOptions,
            useEmoji,
        });

        const content = QuoCallContentBuilder.buildMessageContent({
            message: messageObject,
            userName,
            deepLink,
            formatOptions,
        });

        const activityId = await crmAdapter.createMessageActivity(contactId, {
            title,
            content,
            timestamp: messageObject.createdAt,
            direction: messageObject.direction,
        });

        await mappingRepo.upsert(messageId, {
            messageId,
            noteId: activityId,
            contactId,
            createdAt: new Date().toISOString(),
        });

        console.log(
            `[QuoEventProcessor] ✓ Message logged for contact ${contactId} (note: ${activityId})`,
        );

        if (onActivityCreated) {
            await onActivityCreated({
                messageId,
                contactId,
                contactPhone,
                activityId,
            });
        }

        return {
            logged: true,
            contactId,
            messageId,
            noteId: activityId,
        };
    }

    /**
     * Fetch full call details with voicemail handling for no-answer calls
     * Centralizes the 3-second wait + fetch logic
     *
     * @param {Object} quoApi - Quo API client
     * @param {string} callId - Call ID to fetch
     * @returns {Promise<Object|null>} Call object with voicemail merged, or null if not found
     */
    static async fetchCallWithVoicemail(quoApi, callId) {
        const fullCallResponse = await quoApi.getCall(callId);
        if (!fullCallResponse?.data) {
            return null;
        }

        const call = fullCallResponse.data;

        if (call.status === 'no-answer') {
            console.log(
                `[QuoEventProcessor] No-answer call ${callId}, waiting 3s for voicemail...`,
            );

            await new Promise((resolve) => setTimeout(resolve, 3000));

            try {
                const vmResponse = await quoApi.getCallVoicemails(callId);
                const voicemail = vmResponse?.data;

                if (voicemail && voicemail.status === 'completed') {
                    console.log(
                        `[QuoEventProcessor] Found voicemail for call ${callId}`,
                    );

                    call.voicemail = {
                        duration: voicemail.duration,
                        url: voicemail.recordingUrl,
                        transcript: voicemail.transcript,
                        id: voicemail.id,
                    };
                } else {
                    console.log(
                        `[QuoEventProcessor] No voicemail found for call ${callId}`,
                    );
                }
            } catch (error) {
                console.warn(
                    `[QuoEventProcessor] Could not fetch voicemail: ${error.message}`,
                );
            }
        }

        return call;
    }

    /**
     * Fetch phone number and user metadata from Quo API
     * Parallel fetch with error handling
     *
     * @param {Object} quoApi - Quo API client
     * @param {string} phoneNumberId - Phone number ID
     * @param {string} userId - User ID
     * @returns {Promise<{inboxName: string, inboxNumber: string, userName: string}>}
     */
    static async fetchCallMetadata(quoApi, phoneNumberId, userId) {
        const [phoneNumberDetails, userDetails] = await Promise.all([
            quoApi.getPhoneNumber(phoneNumberId),
            quoApi.getUser(userId),
        ]);

        return {
            inboxName: QuoCallContentBuilder.buildInboxName(phoneNumberDetails),
            inboxNumber: phoneNumberDetails.data?.number || '',
            userName: QuoCallContentBuilder.buildUserName(userDetails),
        };
    }

    /**
     * Format duration for Zoho CRM (MM:SS format)
     * @private
     */
    static _formatDurationForZoho(seconds) {
        if (!seconds || seconds < 0) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

module.exports = QuoWebhookEventProcessor;
