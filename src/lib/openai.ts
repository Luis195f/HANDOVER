import { OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL } from '@/src/config/env';

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    text?: string | null;
  }>;
  error?: {
    message?: string;
  };
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function resolveBaseUrl(): string {
  const raw = OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL;
  return raw.replace(/\/+$/, '');
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as OpenAIChatResponse;
    if (data?.error?.message) return data.error.message;
  } catch {
    // ignore parsing errors
  }
  return `HTTP ${response.status}`;
}

export const openAIClient = {
  isConfigured: Boolean(OPENAI_API_KEY || OPENAI_BASE_URL),
  async complete(prompt: string): Promise<string> {
    if (!openAIClient.isConfigured) {
      throw new Error('OpenAI no está configurado');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 20000) : null;
    const baseUrl = resolveBaseUrl();

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(OPENAI_API_KEY ? { Authorization: `Bearer ${OPENAI_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'Eres un asistente clínico. Responde exclusivamente en el formato solicitado, sin contenido adicional.',
            },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller?.signal,
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as OpenAIChatResponse;
      const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Respuesta vacía de OpenAI');
      }
      return content.trim();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
};
