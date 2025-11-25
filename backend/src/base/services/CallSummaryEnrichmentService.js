/**
 * CallSummaryEnrichmentService
 *
 * Domain service for enriching call notes/activities with AI summaries, recordings, and voicemails.
 * Implements the 3-phase workflow:
 * - Phase 1 (call.completed): Create initial note + store mapping
 * - Phase 2 (call.summary.completed): Fetch recordings/voicemails
 * - Phase 3: Update or recreate note with enriched content
 *
 * Hexagonal Architecture:
 * - Domain logic independent of CRM-specific implementation
 * - CRM adapters implement `canUpdateNote()` and `updateNote()` or fall back to delete+create
 */

const { formatCallRecordings } = require('../../utils/formatCallRecordings');

class CallSummaryEnrichmentService {
    /**
     * Enrich existing call note with AI summary, recordings, and voicemails
     *
     * Strategy:
     * 1. Fetch call recordings and voicemails from Quo API
     * 2. Check if note exists via mapping lookup
     * 3. Build enriched content with hyperlinks
     * 4. Update existing note (if CRM supports) OR delete old + create new
     * 5. Update mapping with new note ID
     *
     * Safety: ALWAYS create new note BEFORE deleting old (prevents data loss)
     *
     * @param {Object} params
     * @param {string} params.callId - Quo call ID
     * @param {Object} params.summaryData - AI summary data {summary: [], nextSteps: []}
     * @param {Object} params.callDetails - Full call object from Quo API
     * @param {Object} params.quoApi - Quo API client
     * @param {Object} params.crmAdapter - CRM-specific adapter {canUpdateNote, createNote, deleteNote, updateNote}
     * @param {Object} params.mappingRepo - Mapping repository {get, upsert}
     * @param {string} params.contactId - CRM contact/record ID
     * @param {Object} params.formatters - Formatting helpers {formatCallHeader, formatDeepLink}
     * @returns {Promise<Object>} Enrichment result {noteId, oldNoteId, enrichedContent}
     */
    static async enrichCallNote({
        callId,
        summaryData,
        callDetails,
        quoApi,
        crmAdapter,
        mappingRepo,
        contactId,
        formatters,
    }) {
        // Phase 2: Fetch recordings and voicemails
        console.log(`[CallEnrichment] Fetching media for call ${callId}`);

        const [recordingsResponse, voicemailsResponse] = await Promise.all([
            quoApi.getCallRecordings(callId).catch((err) => {
                console.warn(`Failed to fetch recordings: ${err.message}`);
                return { data: [] };
            }),
            quoApi.getCallVoicemails(callId).catch((err) => {
                console.warn(`Failed to fetch voicemails: ${err.message}`);
                return { data: null };
            }),
        ]);

        const recordings = recordingsResponse?.data || [];
        const voicemail = voicemailsResponse?.data;

        console.log(
            `[CallEnrichment] Found ${recordings.length} recording(s), ${voicemail ? '1 voicemail' : 'no voicemail'}`,
        );

        // Build enriched content
        const enrichedContent = this._buildEnrichedContent({
            summaryData,
            callDetails,
            recordings,
            voicemail,
            formatters,
        });

        // Look up existing note mapping
        const existingMapping = await mappingRepo.get(callId);
        // Extract noteId from nested mapping structure: { mapping: { noteId: '...' } }
        const oldNoteId = existingMapping?.mapping?.noteId || existingMapping?.noteId || null;

        if (oldNoteId) {
            console.log(
                `[CallEnrichment] Found existing note ${oldNoteId}, will enrich`,
            );
        } else {
            console.log(
                `[CallEnrichment] No existing note found, creating new enriched note`,
            );
        }

        let newNoteId;

        // Phase 3: Update existing note OR delete old + create new
        if (crmAdapter.canUpdateNote && crmAdapter.canUpdateNote()) {
            // CRM supports note updates (e.g., AxisCare)
            console.log(`[CallEnrichment] CRM supports updates, updating note`);

            if (oldNoteId) {
                await crmAdapter.updateNote(oldNoteId, {
                    content: enrichedContent.content,
                    title: enrichedContent.title,
                });
                newNoteId = oldNoteId; // Same note, just updated
                console.log(
                    `[CallEnrichment] ✓ Updated note ${newNoteId}`,
                );
            } else {
                // No existing note, create new
                newNoteId = await crmAdapter.createNote({
                    contactId,
                    content: enrichedContent.content,
                    title: enrichedContent.title,
                    timestamp: callDetails.createdAt,
                });
                console.log(
                    `[CallEnrichment] ✓ Created new note ${newNoteId}`,
                );
            }
        } else {
            // CRM does NOT support updates (e.g., Attio)
            // Strategy: Create new note FIRST, then delete old (safety first!)
            console.log(
                `[CallEnrichment] CRM does not support updates, recreating note`,
            );

            try {
                // Create new enriched note FIRST
                newNoteId = await crmAdapter.createNote({
                    contactId,
                    content: enrichedContent.content,
                    title: enrichedContent.title,
                    timestamp: callDetails.createdAt,
                });

                if (!newNoteId) {
                    throw new Error(
                        'Failed to create enriched note: no note ID returned',
                    );
                }

                console.log(
                    `[CallEnrichment] ✓ Created new enriched note ${newNoteId}`,
                );

                // Delete old note ONLY AFTER new note is successfully created
                if (oldNoteId) {
                    try {
                        await crmAdapter.deleteNote(oldNoteId);
                        console.log(
                            `[CallEnrichment] ✓ Deleted old note ${oldNoteId}`,
                        );
                    } catch (deleteError) {
                        // Non-fatal: New note exists, old note deletion failure is acceptable
                        console.warn(
                            `[CallEnrichment] Warning: Failed to delete old note ${oldNoteId}: ${deleteError.message}`,
                        );
                    }
                }
            } catch (createError) {
                // Fatal: If we can't create the new note, don't delete the old one
                console.error(
                    `[CallEnrichment] Failed to create enriched note: ${createError.message}`,
                );
                throw createError;
            }
        }

        // Update mapping with new note ID
        await mappingRepo.upsert(callId, {
            noteId: newNoteId,
            callId,
            contactId,
            enrichedAt: new Date().toISOString(),
        });

        console.log(
            `[CallEnrichment] ✓ Enrichment complete, note ID: ${newNoteId}`,
        );

        return {
            noteId: newNoteId,
            oldNoteId,
            enrichedContent,
            recordingsCount: recordings.length,
            hasVoicemail: !!voicemail,
        };
    }

    /**
     * Build enriched content string with recordings, voicemails, summary, and next steps
     * @private
     */
    static _buildEnrichedContent({
        summaryData,
        callDetails,
        recordings,
        voicemail,
        formatters,
    }) {
        const { summary = [], nextSteps = [] } = summaryData;

        // Start with call header (status line)
        let content = formatters.formatCallHeader(callDetails);

        // Add recording links inline with status (using formatCallRecordings utility)
        if (recordings.length > 0) {
            const formattedRecordings = formatCallRecordings(recordings, callDetails.duration);
            content += ' / ' + formattedRecordings;
        }

        // Add voicemail
        if (voicemail) {
            content += '\n\n**Voicemail:**\n';
            const vmDuration = voicemail.duration
                ? `(${Math.floor(voicemail.duration / 60)}:${(voicemail.duration % 60).toString().padStart(2, '0')})`
                : '';
            content += `• [Listen to voicemail](${voicemail.recordingUrl}) ${vmDuration}\n`;

            if (voicemail.transcript) {
                content += `\n**Transcript:**\n${voicemail.transcript}\n`;
            }
        }

        // Add AI summary
        if (summary.length > 0) {
            content += '\n\n**Summary:**\n';
            summary.forEach((point) => {
                content += `• ${point}\n`;
            });
        }

        // Add next steps
        if (nextSteps.length > 0) {
            content += '\n**Next Steps:**\n';
            nextSteps.forEach((step) => {
                content += `• ${step}\n`;
            });
        }

        // Add deep link
        content += formatters.formatDeepLink(callDetails);

        // Build title
        const title = formatters.formatTitle(callDetails);

        return { content, title };
    }
}

module.exports = CallSummaryEnrichmentService;
