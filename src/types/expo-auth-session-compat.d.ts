declare module 'expo-auth-session' {
  export type AuthSessionResult = any;
  export type DiscoveryDocument = any;
  export type AuthRequestPromptOptions = any;

  export class AuthRequest {
    codeVerifier?: string;
    codeChallengeMethod?: string;
    promptAsync(
      discovery: DiscoveryDocument | null,
      options?: any
    ): Promise<AuthSessionResult>;
  }

  export function useAutoDiscovery(issuer: string): DiscoveryDocument | null;

  export function useAuthRequest(
    config: any,
    discovery: DiscoveryDocument | null
  ): [AuthRequest, any, (options?: AuthRequestPromptOptions) => Promise<AuthSessionResult>];
}

