const QuoCallContentBuilder = require('./QuoCallContentBuilder');

describe('QuoCallContentBuilder', () => {
    describe('getFormatOptions', () => {
        it('returns markdown formatting by default', () => {
            const options = QuoCallContentBuilder.getFormatOptions();

            expect(options.formatMethod).toBe('markdown');
            expect(options.lineBreak).toBe('\n');
            expect(options.lineBreakDouble).toBe('\n\n');
            expect(options.bold('test')).toBe('**test**');
            expect(options.link('text', 'http://example.com')).toBe(
                '[text](http://example.com)',
            );
            expect(options.emoji.call).toBe('☎️');
            expect(options.emoji.message).toBe('💬');
        });

        it('returns html formatting when specified', () => {
            const options = QuoCallContentBuilder.getFormatOptions('html');

            expect(options.formatMethod).toBe('html');
            expect(options.lineBreak).toBe('<br>');
            expect(options.lineBreakDouble).toBe('<br><br>');
            expect(options.bold('test')).toBe('<strong>test</strong>');
            expect(options.link('text', 'http://example.com')).toBe(
                '<a href="http://example.com">text</a>',
            );
            expect(options.emoji.call).toBe('☎️');
        });

        it('returns plainText formatting when specified', () => {
            const options = QuoCallContentBuilder.getFormatOptions('plainText');

            expect(options.formatMethod).toBe('plainText');
            expect(options.lineBreak).toBe('\r\n');
            expect(options.lineBreakDouble).toBe('\r\n\r\n');
            expect(options.bold('test')).toBe('test');
            expect(options.link('text', 'http://example.com')).toBe(
                'text: http://example.com',
            );
            expect(options.emoji.call).toBe('');
            expect(options.emoji.message).toBe('');
            expect(options.emoji.recording).toBe('');
            expect(options.emoji.voicemail).toBe('');
        });
    });

    describe('buildCallStatus', () => {
        const userName = 'John Doe';

        it('returns correct status for completed outgoing call', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'completed',
                    direction: 'outgoing',
                    answeredAt: '2024-01-01T10:00:00Z',
                },
                userName,
            });

            expect(result).toBe('Outgoing initiated by John Doe');
        });

        it('returns correct status for completed incoming call', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'completed',
                    direction: 'incoming',
                    answeredAt: '2024-01-01T10:00:00Z',
                },
                userName,
            });

            expect(result).toBe('Incoming answered by John Doe');
        });

        it('returns correct status for no-answer call', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'no-answer',
                    direction: 'incoming',
                    answeredAt: null,
                },
                userName,
            });

            expect(result).toBe('Incoming missed');
        });

        it('returns correct status for missed call', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'missed',
                    direction: 'incoming',
                    answeredAt: null,
                },
                userName,
            });

            expect(result).toBe('Incoming missed');
        });

        it('returns correct status for completed incoming but not answered', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'completed',
                    direction: 'incoming',
                    answeredAt: null,
                },
                userName,
            });

            expect(result).toBe('Incoming missed');
        });

        it('returns correct status for outgoing not answered', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'completed',
                    direction: 'outgoing',
                    answeredAt: null,
                },
                userName,
            });

            expect(result).toBe(
                'Outgoing initiated by John Doe (not answered)',
            );
        });

        it('returns correct status for forwarded call with destination', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'forwarded',
                    direction: 'incoming',
                    answeredAt: null,
                    forwardedTo: '+1234567890',
                },
                userName,
            });

            expect(result).toBe('Incoming forwarded to +1234567890');
        });

        it('returns correct status for forwarded call by phone menu', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'forwarded',
                    direction: 'incoming',
                    answeredAt: null,
                    forwardedTo: null,
                },
                userName,
            });

            expect(result).toBe('Incoming forwarded by phone menu');
        });

        it('returns correct status for AI-handled call', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'completed',
                    direction: 'incoming',
                    answeredAt: '2024-01-01T10:00:00Z',
                    aiHandled: 'ai-agent',
                },
                userName,
            });

            expect(result).toBe('Handled by Sona');
        });

        it('returns fallback status for unknown status', () => {
            const result = QuoCallContentBuilder.buildCallStatus({
                call: {
                    status: 'unknown',
                    direction: 'incoming',
                    answeredAt: null,
                },
                userName,
            });

            expect(result).toBe('Incoming unknown');
        });
    });

    describe('buildCallTitle', () => {
        const baseParams = {
            inboxName: '📞 Sales',
            inboxNumber: '+1234567890',
            contactPhone: '+0987654321',
        };

        it('builds outgoing call title with emoji for markdown', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildCallTitle({
                call: { direction: 'outgoing' },
                ...baseParams,
                formatOptions,
            });

            expect(result).toBe('☎️  Call 📞 Sales +1234567890 → +0987654321');
        });

        it('builds incoming call title with emoji for markdown', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildCallTitle({
                call: { direction: 'incoming' },
                ...baseParams,
                formatOptions,
            });

            expect(result).toBe('☎️  Call +0987654321 → 📞 Sales +1234567890');
        });

        it('builds call title without emoji for plainText', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('plainText');
            const result = QuoCallContentBuilder.buildCallTitle({
                call: { direction: 'outgoing' },
                ...baseParams,
                formatOptions,
            });

            expect(result).toBe('Call 📞 Sales +1234567890 → +0987654321');
        });

        it('builds outgoing call title with "from X to Y" format when useEmoji is false', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildCallTitle({
                call: { direction: 'outgoing' },
                ...baseParams,
                formatOptions,
                useEmoji: false,
            });

            expect(result).toBe('Call from +1234567890 to +0987654321');
        });

        it('builds incoming call title with "from X to Y" format when useEmoji is false', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildCallTitle({
                call: { direction: 'incoming' },
                ...baseParams,
                formatOptions,
                useEmoji: false,
            });

            expect(result).toBe('Call from +0987654321 to +1234567890');
        });
    });

    describe('buildMessageTitle', () => {
        const baseParams = {
            inboxName: '💬 Support',
            inboxNumber: '+1234567890',
            contactPhone: '+0987654321',
        };

        it('builds outgoing message title with emoji for markdown', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageTitle({
                message: { direction: 'outgoing' },
                ...baseParams,
                formatOptions,
            });

            expect(result).toBe(
                '💬 Message 💬 Support +1234567890 → +0987654321',
            );
        });

        it('builds incoming message title with emoji for markdown', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageTitle({
                message: { direction: 'incoming' },
                ...baseParams,
                formatOptions,
            });

            expect(result).toBe(
                '💬 Message +0987654321 → 💬 Support +1234567890',
            );
        });

        it('builds message title without emoji for plainText', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('plainText');
            const result = QuoCallContentBuilder.buildMessageTitle({
                message: { direction: 'outgoing' },
                ...baseParams,
                formatOptions,
            });

            expect(result).toBe('Message 💬 Support +1234567890 → +0987654321');
        });

        it('builds outgoing message title with "from X to Y" format when useEmoji is false', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageTitle({
                message: { direction: 'outgoing' },
                ...baseParams,
                formatOptions,
                useEmoji: false,
            });

            expect(result).toBe('Message from +1234567890 to +0987654321');
        });

        it('builds incoming message title with "from X to Y" format when useEmoji is false', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageTitle({
                message: { direction: 'incoming' },
                ...baseParams,
                formatOptions,
                useEmoji: false,
            });

            expect(result).toBe('Message from +0987654321 to +1234567890');
        });
    });

    describe('buildMessageContent', () => {
        it('builds outgoing message content with markdown links', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageContent({
                message: { direction: 'outgoing', text: 'Hello there!' },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/msg/123',
                formatOptions,
            });

            expect(result).toBe(
                'John Doe sent: Hello there!\n\n[View the message activity in Quo](https://app.quo.com/msg/123)',
            );
        });

        it('builds incoming message content', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageContent({
                message: { direction: 'incoming', text: 'Hi!' },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/msg/123',
                formatOptions,
            });

            expect(result).toBe(
                'Received: Hi!\n\n[View the message activity in Quo](https://app.quo.com/msg/123)',
            );
        });

        it('handles empty message text', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildMessageContent({
                message: { direction: 'outgoing', text: '' },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/msg/123',
                formatOptions,
            });

            expect(result).toContain('(no text)');
        });

        it('uses HTML formatting when specified', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('html');
            const result = QuoCallContentBuilder.buildMessageContent({
                message: { direction: 'outgoing', text: 'Test' },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/msg/123',
                formatOptions,
            });

            expect(result).toContain('<a href="https://app.quo.com/msg/123">');
            expect(result).toContain('<br><br>');
        });

        it('uses plainText formatting when specified', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('plainText');
            const result = QuoCallContentBuilder.buildMessageContent({
                message: { direction: 'outgoing', text: 'Test' },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/msg/123',
                formatOptions,
            });

            expect(result).toContain(
                'View the message activity in Quo: https://app.quo.com/msg/123',
            );
            expect(result).toContain('\r\n\r\n');
        });
    });

    describe('buildVoicemailSection', () => {
        it('returns empty string when no voicemail', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: null,
                formatOptions,
            });

            expect(result).toBe('');
        });

        it('returns empty string when voicemail has no duration', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: { url: 'http://example.com/vm.mp3' },
                formatOptions,
            });

            expect(result).toBe('');
        });

        it('builds voicemail section with URL for markdown', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: {
                    duration: 35,
                    url: 'http://example.com/vm.mp3',
                },
                formatOptions,
            });

            expect(result).toContain('**Voicemail:**');
            expect(result).toContain(
                '[Listen to voicemail](http://example.com/vm.mp3)',
            );
            expect(result).toContain('(0:35)');
        });

        it('builds voicemail section with transcript', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: {
                    duration: 35,
                    url: 'http://example.com/vm.mp3',
                    transcript: 'Hello, this is a test message.',
                },
                formatOptions,
            });

            expect(result).toContain('**Transcript:**');
            expect(result).toContain('Hello, this is a test message.');
        });

        it('builds voicemail section without URL', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: {
                    duration: 35,
                    url: null,
                },
                formatOptions,
            });

            expect(result).toContain('➿ Voicemail');
            expect(result).toContain('(0:35)');
        });

        it('uses HTML formatting for voicemail', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('html');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: {
                    duration: 65,
                    url: 'http://example.com/vm.mp3',
                },
                formatOptions,
            });

            expect(result).toContain('<strong>Voicemail:</strong>');
            expect(result).toContain(
                '<a href="http://example.com/vm.mp3">Listen to voicemail</a>',
            );
            expect(result).toContain('(1:05)');
        });

        it('uses plainText formatting for voicemail without emoji', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('plainText');
            const result = QuoCallContentBuilder.buildVoicemailSection({
                voicemail: {
                    duration: 35,
                    url: null,
                },
                formatOptions,
            });

            expect(result).toContain('Voicemail (0:35)');
            expect(result).not.toContain('➿');
        });
    });

    describe('buildRecordingSuffix', () => {
        it('returns recording suffix for answered completed call', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildRecordingSuffix({
                call: {
                    status: 'completed',
                    duration: 125,
                    answeredAt: '2024-01-01T10:00:00Z',
                },
                formatOptions,
            });

            expect(result).toBe(' / ▶️ Recording (2:05)');
        });

        it('returns empty string for unanswered call', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildRecordingSuffix({
                call: {
                    status: 'completed',
                    duration: 125,
                    answeredAt: null,
                },
                formatOptions,
            });

            expect(result).toBe('');
        });

        it('returns empty string for call with zero duration', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildRecordingSuffix({
                call: {
                    status: 'completed',
                    duration: 0,
                    answeredAt: '2024-01-01T10:00:00Z',
                },
                formatOptions,
            });

            expect(result).toBe('');
        });

        it('returns recording suffix without emoji for plainText', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('plainText');
            const result = QuoCallContentBuilder.buildRecordingSuffix({
                call: {
                    status: 'completed',
                    duration: 125,
                    answeredAt: '2024-01-01T10:00:00Z',
                },
                formatOptions,
            });

            expect(result).toBe(' / Recording (2:05)');
            expect(result).not.toContain('▶️');
        });
    });

    describe('buildDeepLink', () => {
        it('builds deep link for call with markdown', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildDeepLink({
                deepLink: 'https://app.quo.com/call/123',
                formatOptions,
                activityType: 'call',
            });

            expect(result).toBe(
                '\n\n[View the call activity in Quo](https://app.quo.com/call/123)',
            );
        });

        it('builds deep link for message', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildDeepLink({
                deepLink: 'https://app.quo.com/msg/123',
                formatOptions,
                activityType: 'message',
            });

            expect(result).toContain('View the message activity in Quo');
        });

        it('uses HTML formatting', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('html');
            const result = QuoCallContentBuilder.buildDeepLink({
                deepLink: 'https://app.quo.com/call/123',
                formatOptions,
            });

            expect(result).toContain('<br><br>');
            expect(result).toContain('<a href="https://app.quo.com/call/123">');
        });
    });

    describe('buildCallContent', () => {
        it('builds complete call content with all sections', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildCallContent({
                call: {
                    status: 'no-answer',
                    direction: 'incoming',
                    answeredAt: null,
                    duration: 0,
                    voicemail: {
                        duration: 30,
                        url: 'http://example.com/vm.mp3',
                        transcript: 'Please call me back.',
                    },
                },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/call/123',
                formatOptions,
            });

            expect(result).toContain('Incoming missed');
            expect(result).toContain('**Voicemail:**');
            expect(result).toContain('Listen to voicemail');
            expect(result).toContain('**Transcript:**');
            expect(result).toContain('Please call me back.');
            expect(result).toContain('View the call activity in Quo');
        });

        it('builds call content without voicemail', () => {
            const formatOptions =
                QuoCallContentBuilder.getFormatOptions('markdown');
            const result = QuoCallContentBuilder.buildCallContent({
                call: {
                    status: 'completed',
                    direction: 'outgoing',
                    answeredAt: '2024-01-01T10:00:00Z',
                    duration: 180,
                },
                userName: 'John Doe',
                deepLink: 'https://app.quo.com/call/123',
                formatOptions,
            });

            expect(result).toContain('Outgoing initiated by John Doe');
            expect(result).toContain('▶️ Recording (3:00)');
            expect(result).not.toContain('Voicemail');
        });
    });

    describe('buildInboxName', () => {
        it('builds inbox name with symbol and name', () => {
            const result = QuoCallContentBuilder.buildInboxName({
                data: { symbol: '📞', name: 'Sales' },
            });

            expect(result).toBe('📞 Sales');
        });

        it('returns name only if no symbol', () => {
            const result = QuoCallContentBuilder.buildInboxName({
                data: { name: 'Sales' },
            });

            expect(result).toBe('Sales');
        });

        it('returns default if no data', () => {
            const result = QuoCallContentBuilder.buildInboxName(null);

            expect(result).toBe('Quo Line');
        });

        it('uses custom default', () => {
            const result = QuoCallContentBuilder.buildInboxName(
                null,
                'Default Inbox',
            );

            expect(result).toBe('Default Inbox');
        });
    });

    describe('buildUserName', () => {
        it('builds user name from first and last name', () => {
            const result = QuoCallContentBuilder.buildUserName({
                data: { firstName: 'John', lastName: 'Doe' },
            });

            expect(result).toBe('John Doe');
        });

        it('returns first name only if no last name', () => {
            const result = QuoCallContentBuilder.buildUserName({
                data: { firstName: 'John' },
            });

            expect(result).toBe('John');
        });

        it('returns default if no data', () => {
            const result = QuoCallContentBuilder.buildUserName(null);

            expect(result).toBe('Quo User');
        });

        it('uses custom default', () => {
            const result = QuoCallContentBuilder.buildUserName(
                null,
                'Unknown User',
            );

            expect(result).toBe('Unknown User');
        });
    });
});
