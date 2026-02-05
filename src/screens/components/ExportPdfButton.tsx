import React, { useState } from 'react';
import { Alert, Button } from 'react-native';

import { generateHandoverPdf } from '@/src/lib/export/export-pdf';
import { uploadSignedHandoverPdf } from '@/src/lib/fhir-client';
import { useAuth } from '@/src/security/auth';
import type { HandoverValues } from '@/src/validation/schemas';
import { t } from '@/src/i18n';

interface Props {
  handover: HandoverValues;
  onBeforeExport?: () => Promise<boolean> | boolean;
}

export function ExportPdfButton({ handover, onBeforeExport }: Props) {
  const { session } = useAuth();
  const [exporting, setExporting] = useState(false);

  if (!session) return null;

  const handleExport = async () => {
    if (exporting) return;
    const canProceed = (await onBeforeExport?.()) ?? true;
    if (!canProceed) return;

    try {
      setExporting(true);
      const pdf = await generateHandoverPdf(handover, session);
      await uploadSignedHandoverPdf(pdf, {
        patientId: handover.patientId,
        handoverId: handover.id ?? '',
      });
      Alert.alert(
        t('export.pdfSuccessTitle'),
        t('export.pdfSignedUploadMessage', { uri: pdf.uri }),
      );
    } catch (error) {
      const details = error instanceof Error ? `\n${error.message}` : '';
      Alert.alert(t('common.error'), `${t('export.pdfErrorMessage')}${details}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      title={exporting ? t('export.exporting') : t('export.exportButton')}
      onPress={handleExport}
      disabled={exporting}
    />
  );
}
