const { trackAnalyticsEvent } = require('./trackAnalyticsEvent');

let warnSpy, logSpy;

beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
});

function createMockIntegration(overrides = {}) {
    return {
        constructor: {
            Definition: {
                name: 'test-integration',
                modules: {
                    quo: {
                        definition: {
                            getName: () => 'quo-module',
                        },
                    },
                },
            },
        },
        userId: 'user-123',
        quo: {
            api: {
                sendAnalyticsEvent: jest.fn().mockResolvedValue({ ok: true }),
            },
        },
        commands: {
            findEntity: jest.fn().mockResolvedValue({
                externalId: 'ext-456',
            }),
            findOrganizationUserById: jest.fn().mockResolvedValue({
                appOrgId: 'org-789',
            }),
        },
        ...overrides,
    };
}

describe('trackAnalyticsEvent', () => {
    it('should track an event successfully', async () => {
        const integration = createMockIntegration();
        await trackAnalyticsEvent(integration, 'ContactUpdated', {
            contactId: '123',
        });

        expect(integration.quo.api.sendAnalyticsEvent).toHaveBeenCalledWith({
            orgId: 'org-789',
            userId: 'ext-456',
            integration: 'test-integration',
            event: 'ContactUpdated',
            data: { contactId: '123' },
        });
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('Tracked ContactUpdated')
        );
    });

    it('should skip tracking when quo api is not available', async () => {
        const integration = createMockIntegration({ quo: null });
        await trackAnalyticsEvent(integration, 'ContactUpdated');

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('not available')
        );
    });

    it('should skip tracking when no quo entity found', async () => {
        const integration = createMockIntegration();
        integration.commands.findEntity.mockResolvedValue(null);

        await trackAnalyticsEvent(integration, 'ContactUpdated');

        expect(integration.quo.api.sendAnalyticsEvent).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('No Quo entity')
        );
    });

    it('should catch and log errors without throwing', async () => {
        const integration = createMockIntegration();
        integration.quo.api.sendAnalyticsEvent.mockRejectedValue(
            new Error('502 Bad Gateway')
        );

        await trackAnalyticsEvent(integration, 'ContactUpdated');

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Failed to track')
        );
    });

    it('should abort analytics call after 5 seconds', async () => {
        jest.useFakeTimers();

        const integration = createMockIntegration();
        integration.quo.api.sendAnalyticsEvent.mockImplementation(
            () =>
                new Promise((resolve) => {
                    setTimeout(() => resolve({ ok: true }), 60_000);
                })
        );

        const trackPromise = trackAnalyticsEvent(integration, 'ContactUpdated');

        await jest.advanceTimersByTimeAsync(5_000);
        await trackPromise;

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('timed out')
        );

        jest.useRealTimers();
    });

    it('should succeed when analytics responds within timeout', async () => {
        jest.useFakeTimers();

        const integration = createMockIntegration();
        integration.quo.api.sendAnalyticsEvent.mockImplementation(
            () =>
                new Promise((resolve) => {
                    setTimeout(() => resolve({ ok: true }), 1_000);
                })
        );

        const trackPromise = trackAnalyticsEvent(integration, 'ContactUpdated');

        await jest.advanceTimersByTimeAsync(1_000);
        await trackPromise;

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('Tracked ContactUpdated')
        );
        expect(warnSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('timed out')
        );

        jest.useRealTimers();
    });
});
