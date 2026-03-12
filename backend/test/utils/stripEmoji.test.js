const stripEmoji = require('../../src/utils/stripEmoji');

describe('stripEmoji', () => {
    it('removes emoji from inbox name with symbol', () => {
        expect(stripEmoji('📞 Primary')).toBe('Primary');
    });

    it('removes emoji prefix from call title', () => {
        expect(stripEmoji('☎️  Call +15706231762 → 📞 Primary +12406701788')).toBe(
            'Call +15706231762 → Primary +12406701788',
        );
    });

    it('removes message emoji', () => {
        expect(stripEmoji('💬 Message +15706231762 → 📞 Primary +12406701788')).toBe(
            'Message +15706231762 → Primary +12406701788',
        );
    });

    it('removes recording and voicemail emoji', () => {
        expect(stripEmoji('▶️ Recording')).toBe('Recording');
        expect(stripEmoji('➿ Voicemail')).toBe('Voicemail');
    });

    it('leaves plain text unchanged', () => {
        expect(stripEmoji('Call +15706231762 → Primary +12406701788')).toBe(
            'Call +15706231762 → Primary +12406701788',
        );
    });

    it('handles null and undefined gracefully', () => {
        expect(stripEmoji(null)).toBeNull();
        expect(stripEmoji(undefined)).toBeUndefined();
        expect(stripEmoji('')).toBe('');
    });

    it('collapses extra whitespace left by removed emoji', () => {
        expect(stripEmoji('📞  Primary')).toBe('Primary');
    });
});
