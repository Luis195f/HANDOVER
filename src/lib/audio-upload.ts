import { API_BASE_URL } from '@/src/config/env';
import { ensureFreshAccessToken } from '@/src/security/auth';
import { detectMimeFromUri, ensureFileName, isSupportedAudioMime } from '@/src/lib/media';

export type AudioToFhirResult =
  | { ok: true; documentReference: unknown }
  | { ok: false; code: 'UNSUPPORTED_MIME' | 'NETWORK' | 'UNAVAILABLE' | 'UNKNOWN' };

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
]);

const normalizeAudioMime = (mime: string) => {
  if (mime === 'audio/mp4') return 'audio/m4a';
  return mime;
};

export async function uploadAudioToFhir(params: {
  uri: string;
  patientId: string;
  label?: string;
  encounterRef?: string;
}): Promise<AudioToFhirResult> {
  if (!API_BASE_URL) {
    return { ok: false, code: 'UNAVAILABLE' };
  }

  const resolvedMime = normalizeAudioMime(detectMimeFromUri(params.uri));
  if (!isSupportedAudioMime(resolvedMime) || !ALLOWED_AUDIO_MIME_TYPES.has(resolvedMime)) {
    return { ok: false, code: 'UNSUPPORTED_MIME' };
  }

  const token = await ensureFreshAccessToken();
  const formData = new FormData();
  formData.append('patientId', params.patientId);
  if (params.label) {
    formData.append('label', params.label);
  }
  if (params.encounterRef) {
    formData.append('encounterRef', params.encounterRef);
  }

  const name = ensureFileName(params.uri.split('/').pop() ?? 'audio', resolvedMime);
  formData.append('file', { uri: params.uri, name, type: resolvedMime } as unknown as Blob);

  try {
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${API_BASE_URL}/upload/audio-to-fhir`, {
      method: 'POST',
      body: formData,
      headers,
    });

    if (!response.ok) {
      return { ok: false, code: 'NETWORK' };
    }

    const payload = await response.json();
    return { ok: true, documentReference: payload };
  } catch {
    return { ok: false, code: 'UNKNOWN' };
  }
}
