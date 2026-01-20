const PipedriveIntegration = require('./PipedriveIntegration');

describe('PipedriveIntegration - App Uninstall Handler', () => {
    let integration;
    let mockReq;
    let mockRes;
    let mockCommands;
    let originalEnv;

    beforeEach(() => {
        // Save original env
        originalEnv = { ...process.env };

        // Set up Pipedrive credentials
        process.env.PIPEDRIVE_CLIENT_ID = 'test-client-id';
        process.env.PIPEDRIVE_CLIENT_SECRET = 'test-client-secret';

        // Create fresh integration instance
        integration = new PipedriveIntegration();

        // Mock response object
        mockRes = {
            json: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
        };

        // Mock Frigg commands
        mockCommands = {
            findIntegrationContextByExternalEntityId: jest.fn(),
            deleteIntegrationById: jest.fn(),
            deleteCredentialById: jest.fn(),
            deleteEntityById: jest.fn(),
            updateIntegrationConfig: jest.fn(),
        };
        integration.commands = mockCommands;

        // Mock onDelete to avoid actual cleanup
        integration.onDelete = jest.fn().mockResolvedValue(undefined);

        // Spy on console methods to verify logging
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        // Restore original env
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    describe('Basic Auth Verification', () => {
        it('should return success when Authorization header is missing', async () => {
            // Arrange
            mockReq = {
                headers: {},
                body: { company_id: '12345' },
            };

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Invalid or missing Basic Auth credentials',
            );
            expect(
                mockCommands.findIntegrationContextByExternalEntityId,
            ).not.toHaveBeenCalled();
        });

        it('should return success when Authorization header does not start with Basic', async () => {
            // Arrange
            mockReq = {
                headers: {
                    authorization: 'Bearer some-token',
                },
                body: { company_id: '12345' },
            };

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Invalid or missing Basic Auth credentials',
            );
        });

        it('should return success when credentials do not match', async () => {
            // Arrange
            const wrongCredentials = Buffer.from(
                'wrong-id:wrong-secret',
            ).toString('base64');
            mockReq = {
                headers: {
                    authorization: `Basic ${wrongCredentials}`,
                },
                body: { company_id: '12345' },
            };

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Invalid or missing Basic Auth credentials',
            );
        });

        it('should proceed when credentials are valid', async () => {
            // Arrange
            const validCredentials = Buffer.from(
                'test-client-id:test-client-secret',
            ).toString('base64');
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { error: 404 },
            );

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(
                mockCommands.findIntegrationContextByExternalEntityId,
            ).toHaveBeenCalledWith('12345');
        });

        it('should return success when PIPEDRIVE_CLIENT_ID is not configured', async () => {
            // Arrange
            delete process.env.PIPEDRIVE_CLIENT_ID;
            const credentials = Buffer.from(
                'test-client-id:test-client-secret',
            ).toString('base64');
            mockReq = {
                headers: {
                    authorization: `Basic ${credentials}`,
                },
                body: { company_id: '12345' },
            };

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] PIPEDRIVE_CLIENT_ID or PIPEDRIVE_CLIENT_SECRET not configured',
            );
        });
    });

    describe('Request Body Validation', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        it('should return success when company_id is missing', async () => {
            // Arrange
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { user_id: '67890' },
            };

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Missing company_id in request body',
            );
        });

        it('should extract company_id and user_id from request body', async () => {
            // Arrange
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: {
                    company_id: '12345',
                    user_id: '67890',
                    timestamp: '2024-01-01T00:00:00Z',
                },
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { error: 404 },
            );

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(console.log).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Processing uninstall for company_id: 12345, user_id: 67890',
            );
        });
    });

    describe('Integration Lookup', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        beforeEach(() => {
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };
        });

        it('should return success when integration is not found (idempotent)', async () => {
            // Arrange
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { error: 404, reason: 'Not found' },
            );

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('Integration not found'),
            );
            expect(integration.onDelete).not.toHaveBeenCalled();
        });

        it('should find integration by company_id (external entity ID)', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: { someConfig: true },
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(
                mockCommands.findIntegrationContextByExternalEntityId,
            ).toHaveBeenCalledWith('12345');
            expect(console.log).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Found integration: integration-123',
            );
        });
    });

    describe('Integration Deletion Flow', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        beforeEach(() => {
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };
        });

        it('should call onDelete with correct parameters', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: { webhookIds: ['wh-1'] },
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(integration.onDelete).toHaveBeenCalledWith({
                integrationId: 'integration-123',
                triggeredBy: 'pipedrive_uninstall',
                pipedriveUserId: '67890',
                companyId: '12345',
            });
        });

        it('should delete integration after onDelete completes', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: {},
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteIntegrationById).toHaveBeenCalledWith(
                'integration-123',
            );
            expect(console.log).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Successfully deleted integration: integration-123',
            );
        });

        it('should continue deletion even if onDelete throws error', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: {},
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });
            integration.onDelete.mockRejectedValue(
                new Error('Webhook cleanup failed'),
            );

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Error in onDelete:',
                'Webhook cleanup failed',
            );
            expect(mockCommands.deleteIntegrationById).toHaveBeenCalledWith(
                'integration-123',
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });

        it('should return success even if deleteIntegrationById returns error', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: {},
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                error: 500,
                reason: 'Database error',
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Failed to delete integration integration-123:',
                'Database error',
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
        });
    });

    describe('Instance Hydration', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        beforeEach(() => {
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };
        });

        it('should hydrate integration instance with context data', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    _id: 'integration-123-mongo',
                    config: { customSetting: 'value' },
                },
                modules: {
                    pipedrive: { api: { someMethod: jest.fn() } },
                    quo: { api: { anotherMethod: jest.fn() } },
                },
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(integration.id).toBe('integration-123');
            expect(integration.record).toBe(mockContext.record);
            expect(integration.config).toEqual({ customSetting: 'value' });
            expect(integration.pipedrive).toBe(mockContext.modules.pipedrive);
            expect(integration.quo).toBe(mockContext.modules.quo);
        });

        it('should use _id when id is not present', async () => {
            // Arrange
            const mockContext = {
                record: {
                    _id: 'mongo-object-id',
                    config: {},
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteIntegrationById).toHaveBeenCalledWith(
                'mongo-object-id',
            );
        });
    });

    describe('Cascade Deletion', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        beforeEach(() => {
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };
        });

        it('should delete credentials and entities for this integration only', async () => {
            // Arrange - entities contain nested credential objects (as returned by API)
            const mockContext = {
                record: {
                    id: 'integration-123',
                    entities: [
                        { id: 'entity-1', credential: { id: 'cred-1' } },
                        { id: 'entity-2', credential: { id: 'cred-2' } },
                    ],
                    config: {},
                },
                modules: {},
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteCredentialById.mockResolvedValue({
                success: true,
            });
            mockCommands.deleteEntityById.mockResolvedValue({ success: true });
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteCredentialById).toHaveBeenCalledWith(
                'cred-1',
            );
            expect(mockCommands.deleteCredentialById).toHaveBeenCalledWith(
                'cred-2',
            );
            expect(mockCommands.deleteEntityById).toHaveBeenCalledWith(
                'entity-1',
            );
            expect(mockCommands.deleteEntityById).toHaveBeenCalledWith(
                'entity-2',
            );
        });

        it('should handle entities without credential', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    entities: [
                        { id: 'entity-1' }, // No credential
                    ],
                    config: {},
                },
                modules: {},
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteEntityById.mockResolvedValue({ success: true });
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteCredentialById).not.toHaveBeenCalled();
            expect(mockCommands.deleteEntityById).toHaveBeenCalledWith(
                'entity-1',
            );
        });

        it('should handle nested credential with _id', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    entities: [
                        { id: 'entity-1', credential: { _id: 'cred-obj-id' } },
                    ],
                    config: {},
                },
                modules: {},
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteCredentialById.mockResolvedValue({
                success: true,
            });
            mockCommands.deleteEntityById.mockResolvedValue({ success: true });
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteCredentialById).toHaveBeenCalledWith(
                'cred-obj-id',
            );
        });

        it('should continue deletion if credential deletion fails', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    entities: [
                        { id: 'entity-1', credential: { id: 'cred-1' } },
                        { id: 'entity-2', credential: { id: 'cred-2' } },
                    ],
                    config: {},
                },
                modules: {},
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteCredentialById
                .mockRejectedValueOnce(new Error('Credential delete failed'))
                .mockResolvedValueOnce({ success: true });
            mockCommands.deleteEntityById.mockResolvedValue({ success: true });
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert - Should still delete both entities
            expect(mockCommands.deleteEntityById).toHaveBeenCalledTimes(2);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should skip cascade deletion if no entities in record', async () => {
            // Arrange
            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: {},
                    // No entities
                },
                modules: {},
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteCredentialById).not.toHaveBeenCalled();
            expect(console.log).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] No entities found in integration record',
            );
        });

        it('should handle legacy credentialId field', async () => {
            // Arrange - some entities might have credentialId instead of nested credential
            const mockContext = {
                record: {
                    id: 'integration-123',
                    entities: [{ id: 'entity-1', credentialId: 'cred-legacy' }],
                    config: {},
                },
                modules: {},
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteCredentialById.mockResolvedValue({
                success: true,
            });
            mockCommands.deleteEntityById.mockResolvedValue({ success: true });
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockCommands.deleteCredentialById).toHaveBeenCalledWith(
                'cred-legacy',
            );
            expect(mockCommands.deleteEntityById).toHaveBeenCalledWith(
                'entity-1',
            );
        });
    });

    describe('Graceful Failure', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        it('should return success on unexpected errors', async () => {
            // Arrange
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockRejectedValue(
                new Error('Unexpected database error'),
            );

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            expect(console.error).toHaveBeenCalledWith(
                '[Pipedrive Uninstall] Unexpected error:',
                expect.any(Error),
            );
        });

        it('should always return 200 status per Pipedrive webhook requirements', async () => {
            // Test all error scenarios return 200
            const errorScenarios = [
                {
                    name: 'missing auth',
                    setup: () => {
                        mockReq = {
                            headers: {},
                            body: { company_id: '12345' },
                        };
                    },
                },
                {
                    name: 'invalid auth',
                    setup: () => {
                        mockReq = {
                            headers: { authorization: 'Basic invalid' },
                            body: { company_id: '12345' },
                        };
                    },
                },
                {
                    name: 'missing company_id',
                    setup: () => {
                        mockReq = {
                            headers: {
                                authorization: `Basic ${validCredentials}`,
                            },
                            body: {},
                        };
                    },
                },
                {
                    name: 'integration not found',
                    setup: () => {
                        mockReq = {
                            headers: {
                                authorization: `Basic ${validCredentials}`,
                            },
                            body: { company_id: '12345' },
                        };
                        mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                            { error: 404 },
                        );
                    },
                },
                {
                    name: 'deletion error',
                    setup: () => {
                        mockReq = {
                            headers: {
                                authorization: `Basic ${validCredentials}`,
                            },
                            body: { company_id: '12345' },
                        };
                        mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                            {
                                context: {
                                    record: { id: 'int-1', config: {} },
                                    modules: {},
                                },
                            },
                        );
                        mockCommands.deleteIntegrationById.mockResolvedValue({
                            error: 'Failed',
                        });
                    },
                },
            ];

            for (const scenario of errorScenarios) {
                // Reset
                mockRes.json.mockClear();
                mockRes.status.mockClear();

                // Setup scenario
                scenario.setup();

                // Act
                await integration.handleAppUninstall({
                    req: mockReq,
                    res: mockRes,
                });

                // Assert
                expect(mockRes.status).toHaveBeenCalledWith(200);
                expect(mockRes.json).toHaveBeenCalledWith({ success: true });
            }
        });
    });

    describe('Audit Logging', () => {
        const validCredentials = Buffer.from(
            'test-client-id:test-client-secret',
        ).toString('base64');

        it('should log all operations with [Pipedrive Uninstall] prefix', async () => {
            // Arrange
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };

            const mockContext = {
                record: {
                    id: 'integration-123',
                    config: {},
                },
                modules: {},
            };
            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { context: mockContext },
            );
            mockCommands.deleteIntegrationById.mockResolvedValue({
                success: true,
            });

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert - Check log calls have prefix
            const logCalls = console.log.mock.calls;
            const relevantLogs = logCalls.filter((call) =>
                call[0].toString().includes('[Pipedrive Uninstall]'),
            );
            expect(relevantLogs.length).toBeGreaterThan(0);
        });

        it('should log company_id and user_id', async () => {
            // Arrange
            mockReq = {
                headers: {
                    authorization: `Basic ${validCredentials}`,
                },
                body: { company_id: '12345', user_id: '67890' },
            };

            mockCommands.findIntegrationContextByExternalEntityId.mockResolvedValue(
                { error: 404 },
            );

            // Act
            await integration.handleAppUninstall({
                req: mockReq,
                res: mockRes,
            });

            // Assert
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('company_id: 12345'),
            );
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining('user_id: 67890'),
            );
        });
    });

    describe('_verifyPipedriveBasicAuth', () => {
        it('should return false for null header', () => {
            expect(integration._verifyPipedriveBasicAuth(null)).toBe(false);
        });

        it('should return false for empty header', () => {
            expect(integration._verifyPipedriveBasicAuth('')).toBe(false);
        });

        it('should return false for non-Basic auth', () => {
            expect(integration._verifyPipedriveBasicAuth('Bearer token')).toBe(
                false,
            );
        });

        it('should return true for valid credentials', () => {
            const validCredentials = Buffer.from(
                'test-client-id:test-client-secret',
            ).toString('base64');
            expect(
                integration._verifyPipedriveBasicAuth(
                    `Basic ${validCredentials}`,
                ),
            ).toBe(true);
        });

        it('should return false for invalid credentials', () => {
            const invalidCredentials =
                Buffer.from('wrong:wrong').toString('base64');
            expect(
                integration._verifyPipedriveBasicAuth(
                    `Basic ${invalidCredentials}`,
                ),
            ).toBe(false);
        });
    });
});
