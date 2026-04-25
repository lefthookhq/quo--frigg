const AttioIntegration = require('../src/integrations/AttioIntegration');
const PipedriveIntegration = require('../src/integrations/PipedriveIntegration');

describe('Infrastructure overrides', () => {
    describe('queueConfig.maxConcurrency wiring', () => {
        it('Attio queueConfig.maxConcurrency should be >= 150', () => {
            expect(
                AttioIntegration.CRMConfig.queueConfig.maxConcurrency,
            ).toBeGreaterThanOrEqual(150);
        });

        it('all integrations with CRMConfig should have maxConcurrency defined', () => {
            const integrations = [AttioIntegration, PipedriveIntegration];
            for (const integration of integrations) {
                expect(
                    integration.CRMConfig?.queueConfig?.maxConcurrency,
                ).toBeDefined();
            }
        });
    });
});
