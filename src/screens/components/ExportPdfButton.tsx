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

function buildHandoverId(handover: HandoverValues): string {
  const patientId = handover.patientId ?? 'unknown-patient';
  const shiftStart = handover.administrativeData?.shiftStart ?? 'unknown-start';
  const shiftEnd = handover.administrativeData?.shiftEnd ?? 'unknown-end';
  const shiftType = handover.administrativeData?.shiftType ?? 'unknown-shift';

  const raw = `${patientId}-${shiftType}-${shiftStart}-${shiftEnd}`;
  return raw.replace(/[^\w.-]+/g, '_');
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

      const patientId = handover.patientId ?? '';
      const handoverId = buildHandoverId(handover);

      await uploadSignedHandoverPdf(pdf, {
        patientId,
        handoverId,
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
