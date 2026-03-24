/**
 * AxisCare Integration - Call Log entityId Parsing Tests
 *
 * Verifies that logCallToActivity correctly parses entityId from contactId
 * values that may be prefixed (e.g., "client-625") or plain numeric ("512").
 *
 * Bug: demomark site stored externalIds as "client-625", and parseInt("client-625")
 * returns NaN → serialized as null → AxisCare rejects with 400.
 */

const AxisCareIntegration = require('../src/integrations/AxisCareIntegration');

describe('AxisCareIntegration - logCallToActivity entityId parsing', () => {
    let integration;
    let mockCreateCallLog;

    beforeEach(() => {
        mockCreateCallLog = jest
            .fn()
            .mockResolvedValue({ results: { data: { id: 999 } } });

        integration = new AxisCareIntegration({
            userId: 'test-user',
            id: 'test-integration-id',
        });

        integration.axisCare = {
            api: { createCallLog: mockCreateCallLog },
        };
        integration._getAxisCareApiForSite = jest
            .fn()
            .mockReturnValue({ createCallLog: mockCreateCallLog });
    });

    const baseActivity = {
        callerName: 'Test Caller',
        callerPhone: '+15551234567',
        timestamp: '2026-03-24T21:03:54.000Z',
        direction: 'inbound',
        duration: 30,
        summary: 'Test call',
    };

    it('should parse numeric entityId from prefixed contactId "client-625"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'client-625',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'client', entityId: 625 }]);
    });

    it('should parse numeric entityId from plain numeric contactId "512"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: '512',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'client', entityId: 512 }]);
    });

    it('should parse entityId from other prefixed types like "lead-42"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'lead-42',
            contactType: 'lead',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'lead', entityId: 42 }]);
    });

    it('should parse entityId from "caregiver-100"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'caregiver-100',
            contactType: 'caregiver',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'caregiver', entityId: 100 }]);
    });

    it('should send empty tags when contactId is null', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: null,
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should send empty tags when contactId is undefined', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should send empty tags when contactId is a non-numeric string', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'unknown',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should accept prefixed contactId with large numeric value like "client-5551234567"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'client-5551234567',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'client', entityId: 5551234567 }]);
    });

    it('should parse entityId from numeric contactId passed as a number', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 625,
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'client', entityId: 625 }]);
    });

    it('should send empty tags for unrecognized prefix like "foo-123"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'foo-123',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should send empty tags when contactId has embedded digits like "abc123def"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'abc123def',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should send empty tags when contactId is "0"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: '0',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should send empty tags for "client-0"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'client-0',
            contactType: 'client',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([]);
    });

    it('should parse entityId from "applicant-77"', async () => {
        await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'applicant-77',
            contactType: 'applicant',
        });

        const payload = mockCreateCallLog.mock.calls[0][0];
        expect(payload.tags).toEqual([{ type: 'applicant', entityId: 77 }]);
    });

    it('should still return the created call log id', async () => {
        const result = await integration.logCallToActivity({
            ...baseActivity,
            contactId: 'client-625',
            contactType: 'client',
        });

        expect(result).toBe(999);
    });
});
