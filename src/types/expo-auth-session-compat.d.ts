// Tipos de compatibilidad para expo-auth-session (alivian TS sin tocar lógica)
declare module 'expo-auth-session' {
  export function parse(url: string): any;
  export function fetchDiscoveryAsync(issuer: string): Promise<any>;
  export function revokeAsync(params: any, discovery?: any): Promise<void>;
  export function refreshAsync(config: any, body: any, discovery?: any): Promise<any>;
  export function exchangeCodeAsync(config: any, body: any, discovery?: any): Promise<any>;
  export function makeRedirectUri(opts?: any): string;

  export class AuthRequest {
    constructor(config: any);
    codeVerifier?: string;
    redirectUri?: string;
  }

  export const ResponseType: { Code: string; Token?: string };
}
