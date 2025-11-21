import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';

import type { HandoverValues } from '../../types/handover';
import type { HandoverSession } from '../../security/auth-types';
import { buildHandoverHtml } from './build-handover-html';

export interface GeneratedPdf {
  uri: string;
  name: string;
  mimeType: 'application/pdf';
  createdAt: string;
  author: string;
}

type SbarSection = {
  situation?: string | null;
  background?: string | null;
  assessment?: string | null;
  recommendation?: string | null;
};

export async function generateHandoverPdf(
  handover: HandoverValues & { id?: string; sbar?: SbarSection | null },
  user: HandoverSession,
): Promise<GeneratedPdf> {
  const createdAt = new Date().toISOString();

  const html = buildHandoverHtml({
    handover,
    user,
    generatedAt: createdAt,
  });

  const { uri } = await Print.printToFileAsync({ html });

  const fallbackId = handover.id ?? handover.patientId ?? 'unknown';
  const fileName = `handover_${fallbackId}_${Date.now()}.pdf`;
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    throw new Error('Document directory not available');
  }
  const targetUri = `${documentDirectory}${fileName}`;

  await FileSystem.moveAsync({ from: uri, to: targetUri });

  return {
    uri: targetUri,
    name: fileName,
    mimeType: 'application/pdf',
    createdAt,
    author: user.displayName ?? user.userId ?? '',
  };
}
