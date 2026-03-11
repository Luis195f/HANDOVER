const CLIENT_OPENAI_DISABLED_ERROR = 'CLIENT_OPENAI_DISABLED_USE_BACKEND';

export const openAIClient = {
  isConfigured: false,
  async complete(_prompt: string): Promise<string> {
    throw new Error(CLIENT_OPENAI_DISABLED_ERROR);
  },
};

export { CLIENT_OPENAI_DISABLED_ERROR };
