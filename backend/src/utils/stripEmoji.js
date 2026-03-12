/**
 * Removes emoji characters from a string.
 * Used when writing to CRMs that don't support emoji rendering (e.g. Zoho CRM).
 *
 * @param {string} str
 * @returns {string}
 */
function stripEmoji(str) {
    if (!str) return str;
    return str
        .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = stripEmoji;
