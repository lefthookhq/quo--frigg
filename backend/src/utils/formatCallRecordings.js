/**
 * Format Call Recordings Utility
 *
 * Formats single or multiple call recordings for display in CRM notes/activities.
 * Supports multiple output formats via formatMethod option.
 *
 * Format Methods:
 * - 'markdown' (default): [▶️ Recording (1:16)](url)
 * - 'html': <a href="url">▶️ Recording (1:16)</a>
 * - 'plainText': Recording (1:16): url
 *
 * Format Examples (markdown):
 * - Single recording: [▶️ Recording (1:16)](url)
 * - Multiple recordings: ▶️ Recordings: [Part 1 (0:45)](url1) | [Part 2 (0:30)](url2)
 * - No URL: ▶️ Recording (1:16)
 */

/**
 * Format duration in seconds to MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "1:16" or "0:45")
 */
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format call recordings for display in CRM notes
 *
 * @param {Array<Object>} recordings - Array of recording objects from Quo API
 * @param {number} recordings[].duration - Recording duration in seconds
 * @param {string} recordings[].url - Recording URL (may be null if processing)
 * @param {string} recordings[].id - Recording ID
 * @param {number} [callDuration] - Optional fallback duration from call object
 * @param {Object} [options] - Formatting options
 * @param {string} [options.formatMethod='markdown'] - Output format: 'html', 'markdown', or 'plainText'
 * @param {boolean} [options.useHtml] - DEPRECATED: Use formatMethod: 'html' instead
 * @returns {string|null} Formatted string with recording links, or null if no recordings
 *
 * @example
 * // Single recording (markdown - default)
 * formatCallRecordings([{ duration: 76, url: 'https://...' }])
 * // Returns: "[▶️ Recording (1:16)](https://...)"
 *
 * @example
 * // Single recording (HTML)
 * formatCallRecordings([{ duration: 76, url: 'https://...' }], null, { formatMethod: 'html' })
 * // Returns: "<a href="https://...">▶️ Recording (1:16)</a>"
 *
 * @example
 * // Single recording (plain text)
 * formatCallRecordings([{ duration: 76, url: 'https://...' }], null, { formatMethod: 'plainText' })
 * // Returns: "Recording (1:16): https://..."
 *
 * @example
 * // Multiple recordings
 * formatCallRecordings([
 *   { duration: 45, url: 'https://...1' },
 *   { duration: 30, url: 'https://...2' }
 * ])
 * // Returns: "▶️ Recordings: [Part 1 (0:45)](url1) | [Part 2 (0:30)](url2)"
 */
function formatCallRecordings(
    recordings,
    callDuration = null,
    { formatMethod, useHtml = false } = {},
) {
    if (!recordings || !Array.isArray(recordings) || recordings.length === 0) {
        return null;
    }

    // Support legacy useHtml option for backward compatibility
    const method = formatMethod || (useHtml ? 'html' : 'markdown');

    // Single recording - simple format
    if (recordings.length === 1) {
        const recording = recordings[0];
        const duration = recording.duration || callDuration || 0;
        const formattedDuration = formatDuration(duration);

        if (recording.url) {
            switch (method) {
                case 'html':
                    return `<a href="${recording.url}" target="_blank">▶️ Recording (${formattedDuration})</a>`;
                case 'plainText':
                    return `Recording (${formattedDuration}): ${recording.url}`;
                default:
                    return `[▶️ Recording (${formattedDuration})](${recording.url})`;
            }
        } else {
            // No URL - still show recording info without link
            return method === 'plainText'
                ? `Recording (${formattedDuration})`
                : `▶️ Recording (${formattedDuration})`;
        }
    }

    // Multiple recordings - "Part 1 | Part 2" format
    const recordingLinks = recordings
        .map((recording, index) => {
            const duration = recording.duration || 0;
            const formattedDuration = formatDuration(duration);
            const partNumber = index + 1;

            if (recording.url) {
                switch (method) {
                    case 'html':
                        return `<a href="${recording.url}" target="_blank">Part ${partNumber} (${formattedDuration})</a>`;
                    case 'plainText':
                        return `Part ${partNumber} (${formattedDuration}): ${recording.url}`;
                    default:
                        return `[Part ${partNumber} (${formattedDuration})](${recording.url})`;
                }
            } else {
                return `Part ${partNumber} (${formattedDuration})`;
            }
        })
        .join(' | ');

    // Use emoji prefix only for non-plainText modes
    const prefix = method === 'plainText' ? 'Recordings:' : '▶️ Recordings:';
    return `${prefix} ${recordingLinks}`;
}

/**
 * Format voicemail for display in CRM notes
 *
 * @param {Object} voicemail - Voicemail object from Quo API
 * @param {number} voicemail.duration - Voicemail duration in seconds
 * @param {string} voicemail.url - Voicemail URL (may be null if processing)
 * @param {Object} [options] - Formatting options
 * @param {string} [options.formatMethod='markdown'] - Output format: 'html', 'markdown', or 'plainText'
 * @param {boolean} [options.useHtml] - DEPRECATED: Use formatMethod: 'html' instead
 * @returns {string|null} Formatted string with voicemail link
 *
 * @example
 * // Markdown (default)
 * formatVoicemail({ duration: 35, url: 'https://...' })
 * // Returns: "[➿ Voicemail (0:35)](https://...)"
 *
 * @example
 * // HTML
 * formatVoicemail({ duration: 35, url: 'https://...' }, { formatMethod: 'html' })
 * // Returns: "<a href="https://...">➿ Voicemail (0:35)</a>"
 *
 * @example
 * // Plain text
 * formatVoicemail({ duration: 35, url: 'https://...' }, { formatMethod: 'plainText' })
 * // Returns: "Voicemail (0:35): https://..."
 */
function formatVoicemail(voicemail, { formatMethod, useHtml = false } = {}) {
    if (!voicemail) {
        return null;
    }

    // Support legacy useHtml option for backward compatibility
    const method = formatMethod || (useHtml ? 'html' : 'markdown');

    const duration = voicemail.duration || 0;
    const formattedDuration = formatDuration(duration);

    if (voicemail.url) {
        switch (method) {
            case 'html':
                return `<a href="${voicemail.url}" target="_blank">➿ Voicemail (${formattedDuration})</a>`;
            case 'plainText':
                return `Voicemail (${formattedDuration}): ${voicemail.url}`;
            default:
                return `[➿ Voicemail (${formattedDuration})](${voicemail.url})`;
        }
    } else {
        // No URL - still show voicemail info without link
        return method === 'plainText'
            ? `Voicemail (${formattedDuration})`
            : `➿ Voicemail (${formattedDuration})`;
    }
}

module.exports = {
    formatCallRecordings,
    formatVoicemail,
    formatDuration,
};
