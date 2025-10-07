const {testAutherDefinition} = require('@friggframework/devtools');
const {Authenticator} = require('@friggframework/test');
const {Definition} = require('../definition');
const {connectToDatabase, Auther, createObjectId, disconnectFromDatabase} = require("@friggframework/core");

const mocks = {
    getUserDetails: {
        sub: "1234567890",
        name: "John Doe",
        email: "test@email.com"
    },
    tokenResponse: {
        access_token: "some_access_token",
        token_type: "bearer",
        expires_in: 3600,
        data: {
            id: 1234567890,
            gid: "1234567890",
            name: "John Doe",
            email: "test@email.com"
        },
        refresh_token: "some_refresh_token",
        id_token: "some_id_token",
    },
    authorizeResponse: {
        base: "/redirect/asana",
        data: {
            code: "test-code",
            state: "null"
        }
    }
}

testAutherDefinition(Definition, mocks)

describe.skip('Asana Module Live Tests', () => {
    let module, authUrl;
    beforeAll(async () => {
        await connectToDatabase();
        module = await Auther.getInstance({
            definition: Definition,
            userId: createObjectId(),
        });
    });

    afterAll(async () => {
        await module.CredentialModel.deleteMany();
        await module.EntityModel.deleteMany();
        await disconnectFromDatabase();
    });

    describe('getAuthorizationRequirements() test', () => {
        it('should return auth requirements', async () => {
            const requirements = await module.getAuthorizationRequirements();
            expect(requirements).toBeDefined();
            expect(requirements.type).toEqual('oauth2');
            expect(requirements.url).toBeDefined();
            authUrl = requirements.url;
        });
    });

    describe('Authorization requests', () => {
        let firstRes;
        it('processAuthorizationCallback()', async () => {
            const response = await Authenticator.oauth2(authUrl);
            firstRes = await module.processAuthorizationCallback({
                data: {
                    code: response.data.code,
                },
            });
            expect(firstRes).toBeDefined();
            expect(firstRes.entity_id).toBeDefined();
            expect(firstRes.credential_id).toBeDefined();
        });
        it('retrieves existing entity on subsequent calls', async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const response = await Authenticator.oauth2(authUrl);
            const res = await module.processAuthorizationCallback({
                data: {
                    code: response.data.code,
                },
            });
            expect(res).toEqual(firstRes);
        });
        it('refresh the token', async () => {
            module.api.access_token = 'foobar';
            const res = await module.testAuth();
            expect(res).toBeTruthy();
        });
    });
    describe('Test credential retrieval and module instantiation', () => {
        it('retrieve by entity id', async () => {
            const newModule = await Auther.getInstance({
                userId: module.userId,
                entityId: module.entity.id,
                definition: Definition,
            });
            expect(newModule).toBeDefined();
            expect(newModule.entity).toBeDefined();
            expect(newModule.credential).toBeDefined();
            expect(await newModule.testAuth()).toBeTruthy();

        });

        it('retrieve by credential id', async () => {
            const newModule = await Auther.getInstance({
                userId: module.userId,
                credentialId: module.credential.id,
                definition: Definition,
            });
            expect(newModule).toBeDefined();
            expect(newModule.credential).toBeDefined();
            expect(await newModule.testAuth()).toBeTruthy();

        });
    });
});
