const { phone } = require('phone');

function normalizeToE164(value, country = 'USA') {
    if (!value || typeof value !== 'string') return null;
    const result = phone(value, { country, validateMobilePrefix: false });
    return result.isValid ? result.phoneNumber : null;
}

module.exports = { normalizeToE164 };
