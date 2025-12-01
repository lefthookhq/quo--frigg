/**
 * Format Call Recordings Utility
 *
 * Formats single or multiple call recordings for display in CRM notes/activities.
 * Uses emoji and clickable markdown links for a clean, professional appearance.
 *
 * Format Examples:
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
 * @param {boolean} [options.useHtml=false] - If true, output HTML links instead of markdown
 * @returns {string|null} Formatted string with recording links, or null if no recordings
 *
 * @example
 * // Single recording (markdown)
 * formatCallRecordings([{ duration: 76, url: 'https://...' }])
 * // Returns: "[▶️ Recording (1:16)](https://...)"
 *
 * @example
 * // Single recording (HTML)
 * formatCallRecordings([{ duration: 76, url: 'https://...' }], null, { useHtml: true })
 * // Returns: "<a href="https://...">▶️ Recording (1:16)</a>"
 *
 * @example
 * // Multiple recordings
 * formatCallRecordings([
 *   { duration: 45, url: 'https://...1' },
 *   { duration: 30, url: 'https://...2' }
 * ])
 * // Returns: "▶️ Recordings: [Part 1 (0:45)](url1) | [Part 2 (0:30)](url2)"
 */
function formatCallRecordings(recordings, callDuration = null, { useHtml = false } = {}) {
    if (!recordings || !Array.isArray(recordings) || recordings.length === 0) {
        return null;
    }

    // Single recording - simple format
    if (recordings.length === 1) {
        const recording = recordings[0];
        const duration = recording.duration || callDuration || 0;
        const formattedDuration = formatDuration(duration);

        if (recording.url) {
            if (useHtml) {
                return `<a href="${recording.url}">▶️ Recording (${formattedDuration})</a>`;
            }
            return `[▶️ Recording (${formattedDuration})](${recording.url})`;
        } else {
            return `▶️ Recording (${formattedDuration})`;
        }
    }

    // Multiple recordings - "Part 1 | Part 2" format
    const recordingLinks = recordings
        .map((recording, index) => {
            const duration = recording.duration || 0;
            const formattedDuration = formatDuration(duration);
            const partNumber = index + 1;

            if (recording.url) {
                if (useHtml) {
                    return `<a href="${recording.url}">Part ${partNumber} (${formattedDuration})</a>`;
                }
                return `[Part ${partNumber} (${formattedDuration})](${recording.url})`;
            } else {
                return `Part ${partNumber} (${formattedDuration})`;
            }
        })
        .join(' | ');

    return `▶️ Recordings: ${recordingLinks}`;
}

/**
 * Format voicemail for display in CRM notes
 *
 * @param {Object} voicemail - Voicemail object from Quo API
 * @param {number} voicemail.duration - Voicemail duration in seconds
 * @param {string} voicemail.url - Voicemail URL (may be null if processing)
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.useHtml=false] - If true, output HTML links instead of markdown
 * @returns {string|null} Formatted string with voicemail link
 *
 * @example
 * // Markdown (default)
 * formatVoicemail({ duration: 35, url: 'https://...' })
 * // Returns: "[➿ Voicemail (0:35)](https://...)"
 *
 * @example
 * // HTML
 * formatVoicemail({ duration: 35, url: 'https://...' }, { useHtml: true })
 * // Returns: "<a href="https://...">➿ Voicemail (0:35)</a>"
 */
function formatVoicemail(voicemail, { useHtml = false } = {}) {
    if (!voicemail) {
        return null;
    }

    const duration = voicemail.duration || 0;
    const formattedDuration = formatDuration(duration);

    if (voicemail.url) {
        if (useHtml) {
            return `<a href="${voicemail.url}">➿ Voicemail (${formattedDuration})</a>`;
        }
        return `[➿ Voicemail (${formattedDuration})](${voicemail.url})`;
    } else {
        return `➿ Voicemail (${formattedDuration})`;
    }
}

module.exports = {
    formatCallRecordings,
    formatVoicemail,
    formatDuration,
};
