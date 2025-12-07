declare module 'expo-auth-session' {
  export type DiscoveryDocument = {
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    revocationEndpoint?: string;
    userInfoEndpoint?: string;
  };

  export type PromptAsyncResult = {
    type: 'success' | 'dismiss' | 'cancel';
    params?: Record<string, string | string[] | undefined>;
  };

  export type TokenResponse = {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    idToken?: string;
    scope?: string;
  };

  export class AuthRequest {
    constructor(config: Record<string, unknown>);
    codeVerifier?: string;
    redirectUri?: string;
    scopes?: string[];
    promptAsync(
      discovery: DiscoveryDocument,
      options?: Record<string, string | string[] | number | boolean | undefined>,
    ): Promise<PromptAsyncResult>;
  }

  export const ResponseType: { Code: string };

  export function fetchDiscoveryAsync(issuer: string): Promise<DiscoveryDocument>;
  export function exchangeCodeAsync(
    request: { clientId: string; code: string; redirectUri: string; extraParams?: Record<string, string | undefined> },
    discovery: DiscoveryDocument,
    options?: { code_verifier?: string }
  ): Promise<TokenResponse>;
  export function refreshAsync(
    request: { clientId: string; refreshToken: string; scopes?: string[] },
    discovery: DiscoveryDocument
  ): Promise<TokenResponse>;
  export function revokeAsync(request: { token: string; clientId: string }, discovery: DiscoveryDocument): Promise<void>;
  export function makeRedirectUri(options?: { scheme?: string }): string;
  export function parse(url: string): { params?: Record<string, unknown>; queryParams?: Record<string, unknown> };
}
