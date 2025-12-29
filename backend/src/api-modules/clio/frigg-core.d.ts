// Type declarations for @friggframework/core

declare module '@friggframework/core' {
    export class OAuth2Requester {
        baseUrl: string;
        authorizationUri: string;
        tokenUri: string;
        client_id: string;
        client_secret: string;
        redirect_uri: string;
        scope: string;
        access_token?: string;
        refresh_token?: string;

        constructor(params?: any);

        getTokenFromCode(code: string): Promise<any>;
        setTokens(params: any): Promise<any>;

        _get(options: any): Promise<any>;
        _post(options: any): Promise<any>;
        _patch(options: any): Promise<any>;
        _delete(options: any): Promise<any>;
    }

    export function get(obj: any, path: string, defaultValue?: any): any;

    export interface FriggModuleAuthDefinition {
        API: any;
        getName: () => string;
        moduleName: string;
        modelName: string;
        requiredAuthMethods: {
            getAuthorizationRequirements: (api: any) => any;
            getToken: (api: any, params: any) => Promise<any>;
            getEntityDetails: (
                api: any,
                callbackParams: any,
                tokenResponse: any,
                userId: string,
            ) => Promise<any>;
            apiPropertiesToPersist: {
                credential: string[];
                entity: string[];
            };
            getCredentialDetails: (api: any, userId: string) => Promise<any>;
            testAuthRequest: (api: any) => Promise<any>;
            setAuthParams?: (api: any, params: any) => Promise<any>;
        };
        env: Record<string, string | undefined>;
    }
}
