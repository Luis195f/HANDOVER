import * as FileSystem from 'expo-file-system';

import type { GeneratedPdf } from './export/export-pdf';
import type { HandoverSession } from '../security/auth-types';

export type SignedPdf = {
  uri: string;
  signature: string;
  certificateInfo: { issuer: string; subject: string; validTo: string };
  signedAt: string;
};

export const EIDAS_CLIENT_FLOW_DISABLED_ERROR = 'EIDAS_CLIENT_FLOW_DISABLED';

const buildSignedFilename = (name: string): string =>
  name.toLowerCase().endsWith('.pdf')
    ? name.replace(/\.pdf$/i, '_signed.pdf')
    : `${name}_signed.pdf`;

const persistSignedPdf = async (pdf: GeneratedPdf): Promise<string> => {
  const directory = FileSystem.documentDirectory;
  const targetName = buildSignedFilename(pdf.name);
  const targetUri = directory ? `${directory}${targetName}` : pdf.uri;

  if (pdf.uri !== targetUri) {
    await FileSystem.copyAsync({ from: pdf.uri, to: targetUri });
  }

  return targetUri;
};

/**
 * El flujo eIDAS ya no acepta credenciales ni acceso directo desde el cliente.
 * Hasta que exista un endpoint backend-mediated, la app solo ofrece un mock local en desarrollo.
 */
export async function signPdf(
  pdf: GeneratedPdf,
  userSession: HandoverSession,
): Promise<SignedPdf> {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.NODE_ENV !== 'test') {
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

  throw new Error(EIDAS_CLIENT_FLOW_DISABLED_ERROR);
}
