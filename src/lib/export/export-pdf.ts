import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

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
  if (Platform.OS === 'web') {
    throw new Error('PDF_EXPORT_UNSUPPORTED_ON_WEB');
  }

  const createdAt = new Date().toISOString();

  const html = buildHandoverHtml({
    handover,
    user,
    generatedAt: createdAt,
  });

  const { uri } = await Print.printToFileAsync({ html });
  if (!uri) {
    throw new Error('PDF_EXPORT_FILE_URI_MISSING');
  }

  const fallbackId = handover.id ?? handover.patientId ?? 'unknown';
  const fileName = `handover_${fallbackId}_${Date.now()}.pdf`;
  const documentDirectory = FileSystem.documentDirectory;
  const targetUri = documentDirectory ? `${documentDirectory}${fileName}` : uri;

  if (documentDirectory) {
    await FileSystem.moveAsync({ from: uri, to: targetUri });
  }

  return {
    uri: targetUri,
    name: fileName,
    mimeType: 'application/pdf',
    createdAt,
    author: user.displayName ?? user.userId ?? '',
  };
}
