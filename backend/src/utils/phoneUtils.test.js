const { normalizeToE164 } = require('./phoneUtils');

describe('normalizeToE164', () => {
    it('should normalize a valid US phone number to E.164', () => {
        expect(normalizeToE164('(817) 569-8900')).toBe('+18175698900');
    });

    it('should handle various valid formats', () => {
        expect(normalizeToE164('817-569-8900')).toBe('+18175698900');
        expect(normalizeToE164('+18175698900')).toBe('+18175698900');
        expect(normalizeToE164('8175698900')).toBe('+18175698900');
        expect(normalizeToE164('18175698900')).toBe('+18175698900');
    });

    it('should return null for null, undefined, or non-string input', () => {
        expect(normalizeToE164(null)).toBeNull();
        expect(normalizeToE164(undefined)).toBeNull();
        expect(normalizeToE164(8175698900)).toBeNull();
        expect(normalizeToE164('')).toBeNull();
    });

    it('should return null for garbage phone data', () => {
        expect(normalizeToE164('+189')).toBeNull();
        expect(normalizeToE164('858-877-7382 832432232')).toBeNull();
        expect(normalizeToE164('+1111111')).toBeNull();
    });

    it('should normalize phone with unusual separators if digits are valid', () => {
        expect(normalizeToE164('555*555*5555')).toBe('+15555555555');
    });
});
