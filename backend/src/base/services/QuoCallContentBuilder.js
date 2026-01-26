/**
 * QuoCallContentBuilder
 *
 * Single source of truth for building formatted call/message content.
 * Supports multiple output formats: markdown, html, plainText.
 *
 * Used by:
 * - QuoWebhookEventProcessor (for call.completed and message.* events)
 * - CallSummaryEnrichmentService (for call.summary.completed events)
 */

const { formatDuration } = require('../../utils/formatCallRecordings');

class QuoCallContentBuilder {
    /**
     * Get format options based on formatMethod
     * Returns functions and strings for building formatted content
     *
     * @param {'html'|'markdown'|'plainText'} formatMethod - Output format
     * @returns {Object} Format options with helper functions
     */
    static getFormatOptions(formatMethod = 'markdown') {
        switch (formatMethod) {
            case 'html':
                return {
                    formatMethod: 'html',
                    lineBreak: '<br>',
                    lineBreakDouble: '<br><br>',
                    bold: (text) => `<strong>${text}</strong>`,
                    link: (text, url) =>
                        `<a href="${url}" target="_blank">${text}</a>`,
                    emoji: {
                        call: '☎️',
                        message: '💬',
                        recording: '▶️',
                        voicemail: '➿',
                    },
                };
            case 'plainText':
                return {
                    formatMethod: 'plainText',
                    lineBreak: '\r\n',
                    lineBreakDouble: '\r\n\r\n',
                    bold: (text) => text,
                    link: (text, url) => `${text}: ${url}`,
                    emoji: {
                        call: '',
                        message: '',
                        recording: '',
                        voicemail: '',
                    },
                };
            default:
                return {
                    formatMethod: 'markdown',
                    lineBreak: '\n',
                    lineBreakDouble: '\n\n',
                    bold: (text) => `**${text}**`,
                    link: (text, url) => `[${text}](${url})`,
                    emoji: {
                        call: '☎️',
                        message: '💬',
                        recording: '▶️',
                        voicemail: '➿',
                    },
                };
        }
    }

    /**
     * Build call status description line
     * Determines the status text based on call state (answered, missed, forwarded, etc.)
     *
     * @param {Object} params
     * @param {Object} params.call - Call object from Quo API
     * @param {string} params.call.status - Call status (completed, no-answer, missed, forwarded)
     * @param {string} params.call.direction - Call direction (outgoing, incoming)
     * @param {string|null} params.call.answeredAt - Timestamp when call was answered
     * @param {string} params.call.aiHandled - AI handling status
     * @param {string} params.call.forwardedTo - Phone number call was forwarded to
     * @param {string} params.userName - User name who handled the call
     * @returns {string} Status description
     */
    static buildCallStatus({ call, userName }) {
        const wasAnswered =
            call.answeredAt !== null && call.answeredAt !== undefined;

        // Special case: AI-handled calls
        if (call.aiHandled === 'ai-agent') {
            return 'Handled by Sona';
        }

        // Completed and answered
        if (call.status === 'completed' && wasAnswered) {
            return call.direction === 'outgoing'
                ? `Outgoing initiated by ${userName}`
                : `Incoming answered by ${userName}`;
        }

        // Missed calls (various forms)
        if (
            call.status === 'no-answer' ||
            call.status === 'missed' ||
            (call.status === 'completed' &&
                !wasAnswered &&
                call.direction === 'incoming')
        ) {
            return 'Incoming missed';
        }

        // Outgoing but not answered
        if (
            call.status === 'completed' &&
            !wasAnswered &&
            call.direction === 'outgoing'
        ) {
            return `Outgoing initiated by ${userName} (not answered)`;
        }

        // Forwarded calls
        if (call.status === 'forwarded') {
            return call.forwardedTo
                ? `Incoming forwarded to ${call.forwardedTo}`
                : 'Incoming forwarded by phone menu';
        }

        // Default fallback
        return `${call.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} ${call.status}`;
    }

    /**
     * Build call title with emoji and phone numbers
     *
     * @param {Object} params
     * @param {Object} params.call - Call object with direction
     * @param {string} params.inboxName - Inbox display name (e.g., "📞 Sales")
     * @param {string} params.inboxNumber - Inbox phone number
     * @param {string} params.contactPhone - External contact phone number
     * @param {Object} [params.formatOptions] - Format options (defaults to markdown)
     * @returns {string} Formatted title
     */
    static buildCallTitle({
        call,
        inboxName,
        inboxNumber,
        contactPhone,
        formatOptions,
        useEmoji = true,
    }) {
        if (useEmoji) {
            const { emoji } =
                formatOptions || this.getFormatOptions('markdown');
            const prefix = emoji.call ? `${emoji.call}  ` : '';
            if (call.direction === 'outgoing') {
                return `${prefix}Call ${inboxName} ${inboxNumber} → ${contactPhone}`;
            }
            return `${prefix}Call ${contactPhone} → ${inboxName} ${inboxNumber}`;
        }

        if (call.direction === 'outgoing') {
            return `Call from ${inboxNumber} to ${contactPhone}`;
        }
        return `Call from ${contactPhone} to ${inboxNumber}`;
    }

    /**
     * Build message title with emoji
     *
     * @param {Object} params
     * @param {Object} params.message - Message object with direction, from, to
     * @param {string} params.inboxName - Inbox display name
     * @param {string} params.inboxNumber - Inbox phone number (message.from for outgoing, message.to for incoming)
     * @param {string} params.contactPhone - External contact phone
     * @param {Object} [params.formatOptions] - Format options
     * @returns {string} Formatted title
     */
    static buildMessageTitle({
        message,
        inboxName,
        inboxNumber,
        contactPhone,
        formatOptions,
        useEmoji = true,
    }) {
        if (useEmoji) {
            const { emoji } =
                formatOptions || this.getFormatOptions('markdown');
            const prefix = emoji.message ? `${emoji.message} ` : '';
            if (message.direction === 'outgoing') {
                return `${prefix}Message ${inboxName} ${inboxNumber} → ${contactPhone}`;
            }
            return `${prefix}Message ${contactPhone} → ${inboxName} ${inboxNumber}`;
        }

        if (message.direction === 'outgoing') {
            return `Message from ${inboxNumber} to ${contactPhone}`;
        }
        return `Message from ${contactPhone} to ${inboxNumber}`;
    }

    /**
     * Build message content body
     *
     * @param {Object} params
     * @param {Object} params.message - Message object with text, direction
     * @param {string} params.userName - User name who sent (for outgoing)
     * @param {string} params.deepLink - Deep link URL
     * @param {Object} params.formatOptions - Format options
     * @returns {string} Formatted content
     */
    static buildMessageContent({ message, userName, deepLink, formatOptions }) {
        const { link, lineBreakDouble, formatMethod } = formatOptions;

        const messageText = message.text || '(no text)';
        const deepLinkLine = link('View the message activity in Quo', deepLink);

        let content;
        if (message.direction === 'outgoing') {
            content = `${userName} sent: ${messageText}${lineBreakDouble}${deepLinkLine}`;
        } else {
            content = `Received: ${messageText}${lineBreakDouble}${deepLinkLine}`;
        }
        return formatMethod === 'html' ? `<span>${content}</span>` : content;
    }

    /**
     * Build voicemail section with optional transcript
     *
     * @param {Object} params
     * @param {Object} params.voicemail - Voicemail object { duration, url, transcript }
     * @param {Object} params.formatOptions - Format options
     * @returns {string} Formatted voicemail section (empty string if no voicemail)
     */
    static buildVoicemailSection({ voicemail, formatOptions }) {
        if (!voicemail || !voicemail.duration) {
            return '';
        }

        const { lineBreak, lineBreakDouble, bold, link, emoji } = formatOptions;
        const vmDuration = formatDuration(voicemail.duration);
        const voicemailLabel = emoji.voicemail
            ? `${emoji.voicemail} Voicemail`
            : 'Voicemail';

        let section = lineBreakDouble + bold('Voicemail:') + lineBreak;

        if (voicemail.url) {
            section += `• ${link(`Listen to voicemail`, voicemail.url)} (${vmDuration})${lineBreak}`;
        } else {
            section += `• ${voicemailLabel} (${vmDuration})${lineBreak}`;
        }

        if (voicemail.transcript) {
            section +=
                lineBreak +
                bold('Transcript:') +
                lineBreak +
                voicemail.transcript;
        }

        return section;
    }

    /**
     * Build recording status line suffix
     * Used when adding recording indicator to status line
     *
     * @param {Object} params
     * @param {Object} params.call - Call object with duration
     * @param {Object} params.formatOptions - Format options
     * @returns {string} Recording suffix (e.g., " / ▶️ Recording (1:23)")
     */
    static buildRecordingSuffix({ call, formatOptions }) {
        const wasAnswered =
            call.answeredAt !== null && call.answeredAt !== undefined;

        if (
            call.status !== 'completed' ||
            !call.duration ||
            call.duration <= 0 ||
            !wasAnswered
        ) {
            return '';
        }

        const { emoji } = formatOptions;
        const durationFormatted = formatDuration(call.duration);
        const recordingLabel = emoji.recording
            ? `${emoji.recording} Recording`
            : 'Recording';

        return ` / ${recordingLabel} (${durationFormatted})`;
    }

    /**
     * Build deep link line for call or message
     *
     * @param {Object} params
     * @param {string} params.deepLink - Deep link URL
     * @param {Object} params.formatOptions - Format options
     * @param {'call'|'message'} [params.activityType='call'] - Activity type
     * @returns {string} Formatted deep link line
     */
    static buildDeepLink({ deepLink, formatOptions, activityType = 'call' }) {
        const { link, lineBreakDouble } = formatOptions;
        const text =
            activityType === 'message'
                ? 'View the message activity in Quo'
                : 'View the call activity in Quo';

        return `${lineBreakDouble}${link(text, deepLink)}`;
    }

    /**
     * Build complete call note content
     * Combines status, recording, voicemail, and deep link sections
     *
     * @param {Object} params
     * @param {Object} params.call - Call object from Quo API
     * @param {string} params.userName - User name
     * @param {string} params.deepLink - Deep link URL
     * @param {Object} params.formatOptions - Format options
     * @returns {string} Complete formatted content
     */
    static buildCallContent({ call, userName, deepLink, formatOptions }) {
        const { formatMethod } = formatOptions;

        // Start with status description
        let content = this.buildCallStatus({ call, userName });

        // Add recording suffix if applicable
        content += this.buildRecordingSuffix({ call, formatOptions });

        // Add voicemail section if present
        content += this.buildVoicemailSection({
            voicemail: call.voicemail,
            formatOptions,
        });

        // Add deep link
        content += this.buildDeepLink({ deepLink, formatOptions });

        return formatMethod === 'html' ? `<span>${content}</span>` : content;
    }

    /**
     * Extract inbox display name from phone number details
     *
     * @param {Object} phoneNumberDetails - Phone number details from Quo API
     * @param {string} [defaultName='Quo Line'] - Default name if not found
     * @returns {string} Inbox name
     */
    static buildInboxName(phoneNumberDetails, defaultName = 'Quo Line') {
        const data = phoneNumberDetails?.data;
        if (data?.symbol && data?.name) {
            return `${data.symbol} ${data.name}`;
        }
        return data?.name || defaultName;
    }

    /**
     * Extract user display name from user details
     *
     * @param {Object} userDetails - User details from Quo API
     * @param {string} [defaultName='Quo User'] - Default name if not found
     * @returns {string} User name
     */
    static buildUserName(userDetails, defaultName = 'Quo User') {
        const data = userDetails?.data;
        const fullName =
            `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
        return fullName || defaultName;
    }
}

module.exports = QuoCallContentBuilder;
