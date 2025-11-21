import React, { useState } from 'react';
import { Alert, Button } from 'react-native';

import { generateHandoverPdf } from '@/src/lib/export/export-pdf';
import { useAuth } from '@/src/security/auth';
import type { HandoverValues } from '@/src/validation/schemas';

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
      Alert.alert('Exportación completada', `PDF generado en: ${pdf.uri}`);
      // En el futuro se podría llamar a uploadSignedHandoverPdf(pdf, { patientId: handover.patientId, handoverId: handover.id ?? '' })
    } catch (error) {
      console.warn('[handover] export pdf error', error);
      Alert.alert('Error', 'No se pudo generar el PDF de la entrega.');
    } finally {
      setExporting(false);
    }
  };

  return <Button title={exporting ? 'Exportando…' : 'Exportar PDF'} onPress={handleExport} disabled={exporting} />;
}
