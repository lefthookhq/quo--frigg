/**
 * Format Call Recordings Utility Tests
 */

const { formatCallRecordings, formatVoicemail } = require('../../src/utils/formatCallRecordings');

describe('formatCallRecordings', () => {
    describe('Single Recording', () => {
        it('should format single recording with URL', () => {
            const recordings = [
                {
                    duration: 75,
                    url: 'https://storage.example.com/rec1.mp3',
                },
            ];

            const result = formatCallRecordings(recordings, 75);

            expect(result).toBe('[▶️ Recording (1:15)](https://storage.example.com/rec1.mp3)');
        });

        it('should format single recording without URL', () => {
            const recordings = [
                {
                    duration: 75,
                    url: null,
                },
            ];

            const result = formatCallRecordings(recordings, 75);

            expect(result).toBe('▶️ Recording (1:15)');
        });

        it('should use call duration as fallback when recording duration missing', () => {
            const recordings = [
                {
                    url: 'https://storage.example.com/rec1.mp3',
                },
            ];

            const result = formatCallRecordings(recordings, 90);

            expect(result).toBe('[▶️ Recording (1:30)](https://storage.example.com/rec1.mp3)');
        });
    });

    describe('Multiple Recordings', () => {
        it('should format multiple recordings with URLs', () => {
            const recordings = [
                {
                    duration: 45,
                    url: 'https://storage.example.com/part1.mp3',
                },
                {
                    duration: 30,
                    url: 'https://storage.example.com/part2.mp3',
                },
            ];

            const result = formatCallRecordings(recordings, 75);

            expect(result).toBe(
                '▶️ Recordings: [Part 1 (0:45)](https://storage.example.com/part1.mp3) | [Part 2 (0:30)](https://storage.example.com/part2.mp3)'
            );
        });

        it('should format multiple recordings with some missing URLs', () => {
            const recordings = [
                {
                    duration: 45,
                    url: 'https://storage.example.com/part1.mp3',
                },
                {
                    duration: 30,
                    url: null, // Processing
                },
            ];

            const result = formatCallRecordings(recordings, 75);

            expect(result).toBe(
                '▶️ Recordings: [Part 1 (0:45)](https://storage.example.com/part1.mp3) | Part 2 (0:30)'
            );
        });

        it('should handle three or more recordings', () => {
            const recordings = [
                { duration: 20, url: 'https://example.com/p1.mp3' },
                { duration: 25, url: 'https://example.com/p2.mp3' },
                { duration: 30, url: 'https://example.com/p3.mp3' },
            ];

            const result = formatCallRecordings(recordings, 75);

            expect(result).toContain('Part 1');
            expect(result).toContain('Part 2');
            expect(result).toContain('Part 3');
            expect(result).toContain('|'); // Pipe separator
        });
    });

    describe('Edge Cases', () => {
        it('should return null for empty array', () => {
            const result = formatCallRecordings([], 75);
            expect(result).toBe(null);
        });

        it('should return null for null input', () => {
            const result = formatCallRecordings(null, 75);
            expect(result).toBe(null);
        });

        it('should return null for undefined input', () => {
            const result = formatCallRecordings(undefined, 75);
            expect(result).toBe(null);
        });

        it('should handle zero duration', () => {
            const recordings = [
                {
                    duration: 0,
                    url: 'https://example.com/rec.mp3',
                },
            ];

            const result = formatCallRecordings(recordings, 0);

            expect(result).toBe('[▶️ Recording (0:00)](https://example.com/rec.mp3)');
        });

        it('should handle very long duration', () => {
            const recordings = [
                {
                    duration: 3665, // 1 hour, 1 minute, 5 seconds
                    url: 'https://example.com/rec.mp3',
                },
            ];

            const result = formatCallRecordings(recordings, 3665);

            expect(result).toBe('[▶️ Recording (61:05)](https://example.com/rec.mp3)');
        });
    });
});

describe('formatVoicemail', () => {
    it('should format voicemail with URL', () => {
        const voicemail = {
            duration: 35,
            url: 'https://storage.example.com/vm.mp3',
        };

        const result = formatVoicemail(voicemail);

        expect(result).toBe('[➿ Voicemail (0:35)](https://storage.example.com/vm.mp3)');
    });

    it('should format voicemail without URL', () => {
        const voicemail = {
            duration: 35,
            url: null,
        };

        const result = formatVoicemail(voicemail);

        expect(result).toBe('➿ Voicemail (0:35)');
    });

    it('should return null for null voicemail', () => {
        const result = formatVoicemail(null);
        expect(result).toBe(null);
    });

    it('should return null for undefined voicemail', () => {
        const result = formatVoicemail(undefined);
        expect(result).toBe(null);
    });

    it('should handle long voicemail duration', () => {
        const voicemail = {
            duration: 180, // 3 minutes
            url: 'https://storage.example.com/vm-long.mp3',
        };

        const result = formatVoicemail(voicemail);

        expect(result).toBe('[➿ Voicemail (3:00)](https://storage.example.com/vm-long.mp3)');
    });
});
