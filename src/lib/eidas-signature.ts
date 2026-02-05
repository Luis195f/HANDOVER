import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Buffer } from 'buffer';

import type { GeneratedPdf } from './export/export-pdf';
import type { HandoverSession } from '../security/auth-types';

export type SignedPdf = {
  uri: string;
  signature: string;
  certificateInfo: { issuer: string; subject: string; validTo: string };
  signedAt: string;
};

type EidasSignResponse = {
  signedPdfBase64?: string;
  signature?: string;
  certificateInfo?: {
    issuer?: string;
    subject?: string;
    validTo?: string;
  };
  signedAt?: string;
  timestamp?: string;
};

type EidasConfig = {
  apiUrl?: string;
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
};

const getEidasConfig = (): EidasConfig => ({
  apiUrl: process.env.EXPO_PUBLIC_EIDAS_API_URL,
  clientId: process.env.EXPO_PUBLIC_EIDAS_CLIENT_ID,
  clientSecret: process.env.EXPO_PUBLIC_EIDAS_CLIENT_SECRET,
  apiKey: process.env.EXPO_PUBLIC_EIDAS_API_KEY,
});

const normalizeApiUrl = (url?: string): string | undefined => url?.replace(/\/$/, '');

const toBase64 = (digest: Uint8Array | ArrayBuffer | string): string => {
  if (typeof digest === 'string') {
    try {
      return Buffer.from(digest, 'hex').toString('base64');
    } catch {
      return Buffer.from(digest).toString('base64');
    }
  }
  const bytes = digest instanceof ArrayBuffer ? new Uint8Array(digest) : digest;
  return Buffer.from(bytes).toString('base64');
};

const stripDataUriPrefix = (value: string): string =>
  value.replace(/^data:application\/pdf;base64,/, '');

const buildSignedFilename = (name: string): string => {
  if (name.toLowerCase().endsWith('.pdf')) {
    return name.replace(/\.pdf$/i, '_signed.pdf');
  }
  return `${name}_signed.pdf`;
};

const persistSignedPdf = async (pdf: GeneratedPdf, base64?: string): Promise<string> => {
  const documentDirectory = FileSystem.documentDirectory;
  const targetName = buildSignedFilename(pdf.name);
  const targetUri = documentDirectory ? `${documentDirectory}${targetName}` : pdf.uri;

  if (base64) {
    await FileSystem.writeAsStringAsync(targetUri, stripDataUriPrefix(base64), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return targetUri;
  }

  if (pdf.uri !== targetUri) {
    await FileSystem.copyAsync({ from: pdf.uri, to: targetUri });
  }

  return targetUri;
};

const computePdfHash = async (pdf: GeneratedPdf): Promise<string> => {
  const base64 = await FileSystem.readAsStringAsync(pdf.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = Buffer.from(base64, 'base64');
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return toBase64(digest);
};

const buildSignaturePayload = (
  pdf: GeneratedPdf,
  userSession: HandoverSession,
  hashBase64: string,
) => ({
  hash: hashBase64,
  hashAlgorithm: 'SHA-256',
  documentName: pdf.name,
  createdAt: pdf.createdAt,
  signer: {
    userId: userSession.userId,
    displayName: userSession.displayName ?? userSession.userId,
    email: userSession.email,
  },
});

const buildHeaders = (config: EidasConfig): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(config.clientId ? { 'X-Client-Id': config.clientId } : {}),
  ...(config.clientSecret ? { 'X-Client-Secret': config.clientSecret } : {}),
  ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
});

const normalizeCertificateInfo = (
  info: EidasSignResponse['certificateInfo'] | undefined,
  session: HandoverSession,
): SignedPdf['certificateInfo'] => ({
  issuer: info?.issuer ?? 'unknown',
  subject: info?.subject ?? session.displayName ?? session.userId,
  validTo: info?.validTo ?? '',
});

/**
 * Firma un PDF usando un proveedor eIDAS homologado (PAdES).
 * - En __DEV__ sin API configurada se genera un mock local para no bloquear la UI.
 * - En producción requiere EXPO_PUBLIC_EIDAS_API_URL y credenciales.
 * - Future: soporte de multifirma y timestamp TSA adicional.
 */
export async function signPdf(
  pdf: GeneratedPdf,
  userSession: HandoverSession,
): Promise<SignedPdf> {
  const config = getEidasConfig();
  const apiUrl = normalizeApiUrl(config.apiUrl);

  if (!apiUrl) {
    if (__DEV__) {
      const signedAt = new Date().toISOString();
      const uri = await persistSignedPdf(pdf);
      return {
        uri,
        signature: 'DEV-MOCK-EIDAS-SIGNATURE',
        certificateInfo: {
          issuer: 'DEV-CA',
          subject: userSession.displayName ?? userSession.userId,
          validTo: signedAt,
        },
        signedAt,
      };
    }
    throw new Error('EIDAS_API_URL_MISSING');
  }

  const hashBase64 = await computePdfHash(pdf);
  const response = await fetch(`${apiUrl}/signatures/pades`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(buildSignaturePayload(pdf, userSession, hashBase64)),
  });

  if (!response.ok) {
    throw new Error(`EIDAS_SIGN_FAILED_${response.status}`);
  }

  const payload = (await response.json()) as EidasSignResponse;
  const signedAt = payload.signedAt ?? payload.timestamp ?? new Date().toISOString();
  const signature = payload.signature ?? '';
  const certificateInfo = normalizeCertificateInfo(payload.certificateInfo, userSession);
  const uri = await persistSignedPdf(pdf, payload.signedPdfBase64);

  return {
    uri,
    signature,
    certificateInfo,
    signedAt,
  };
}
