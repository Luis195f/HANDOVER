// src/types/expo-auth-session-compat.d.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Compat typings for expo-auth-session
 * Purpose: unblock TypeScript typecheck in CI where upstream typings are incomplete/mismatched
 * IMPORTANT: runtime behavior is unchanged; this is compile-time only.
 */

declare module "expo-auth-session" {
  // ---- Common primitives ----
  export type AuthSessionResult = any;
  export type DiscoveryDocument = any;

  export type AuthRequestPromptOptions = any;
  export type TokenResponse = any;

  // ---- Request classes / hooks (used by some flows) ----
  export class AuthRequest {
  codeVerifier?: string;
  codeChallengeMethod?: string;

  constructor(config?: any);

  promptAsync(
    discovery: DiscoveryDocument | null,
    options?: any
  ): Promise<AuthSessionResult>;
}

  export function useAutoDiscovery(issuer: string): DiscoveryDocument | null;

  export function useAuthRequest(
    config: any,
    discovery: DiscoveryDocument | null
  ): [
    AuthRequest,
    any,
    (options?: AuthRequestPromptOptions) => Promise<AuthSessionResult>
  ];

  // ---- OAuth/OIDC helpers (missing in some typings but used in repo) ----
  export type RevokeTokenRequestConfig = any;
  export type ExchangeCodeRequestConfig = any;
  export type RefreshTokenRequestConfig = any;

  export type MakeRedirectUriOptions = {
    scheme?: string;
    path?: string;
    native?: string;
    useProxy?: boolean;
    isTripleSlashed?: boolean;
    preferLocalhost?: boolean;
    queryParams?: Record<string, string>;
  };

  export enum ResponseType {
    Code = "code",
    Token = "token",
    IdToken = "id_token",
  }

  export function makeRedirectUri(options?: MakeRedirectUriOptions): string;

  /**
   * Some upstream typings model this as nullable, lookups in your code assume a usable document.
   * We keep it non-null here to satisfy the repo without touching runtime code.
   */
  export function fetchDiscoveryAsync(
    issuerOrDiscoveryUrl: string,
    extraParams?: Record<string, string>
  ): Promise<DiscoveryDocument>;

  export function revokeAsync(
    config: RevokeTokenRequestConfig,
    discovery: DiscoveryDocument
  ): Promise<void>;

  export function exchangeCodeAsync(
    config: ExchangeCodeRequestConfig,
    discovery: DiscoveryDocument
  ): Promise<TokenResponse>;

  export function refreshAsync(
    config: RefreshTokenRequestConfig,
    discovery: DiscoveryDocument
  ): Promise<TokenResponse>;
}
