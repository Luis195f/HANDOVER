// __mocks__/expo-web-browser.ts
// Mock súper simple para las funciones que usa auth.tsx

export type WebBrowserAuthSessionResultType = 'success' | 'cancel' | 'dismiss';

export interface WebBrowserAuthSessionResult {
  type: WebBrowserAuthSessionResultType;
  url?: string | null;
}

// En app real esto intenta completar sesiones anteriores;
// en tests lo dejamos como un "ok" silencioso.
export function maybeCompleteAuthSession() {
  return { type: 'success' as const };
}

// Simula un flujo de auth en navegador y vuelve con éxito
export async function openAuthSessionAsync(
  _url: string,
  redirectUrl: string,
): Promise<WebBrowserAuthSessionResult> {
  return {
    type: 'success',
    url: `${redirectUrl}#mock_token`,
  };
}

const WebBrowser = {
  maybeCompleteAuthSession,
  openAuthSessionAsync,
};

export default WebBrowser;
