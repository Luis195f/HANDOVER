export type PromptResult = {
  type: 'success' | 'dismiss' | 'cancel';
  params?: Record<string, any>;
};

export const promptAsyncMock = jest.fn<Promise<PromptResult>, any>();
export const exchangeCodeAsync = jest.fn();
export const refreshAsync = jest.fn();
export const revokeAsync = jest.fn();
export const fetchDiscoveryAsync = jest.fn(async () => ({
  authorizationEndpoint: 'https://example.com/authorize',
  tokenEndpoint: 'https://example.com/token',
  userInfoEndpoint: 'https://example.com/userinfo',
}));

export const makeRedirectUri = jest.fn(() => 'handoverpro://redirect');

export const ResponseType = {
  Code: 'code',
} as const;

export const parse = jest.fn(() => ({ params: {} }));

export class AuthRequest {
  public codeVerifier: string;
  public redirectUri: string;
  public scopes: string[];
  constructor(config: { redirectUri: string; scopes: string[] }) {
    this.redirectUri = config.redirectUri;
    this.scopes = config.scopes;
    this.codeVerifier = 'code-verifier';
  }

  async promptAsync(...args: any[]): Promise<PromptResult> {
    return promptAsyncMock(...args);
  }
}

export const __reset = () => {
  promptAsyncMock.mockReset();
  exchangeCodeAsync.mockReset();
  refreshAsync.mockReset();
  revokeAsync.mockReset();
  fetchDiscoveryAsync.mockClear();
  makeRedirectUri.mockClear();
  parse.mockImplementation(() => ({ params: {} }));
};
