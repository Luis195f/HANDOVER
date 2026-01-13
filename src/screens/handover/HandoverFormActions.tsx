import React from 'react';
import { Button, View } from 'react-native';
import { ExportPdfButton } from '../components/ExportPdfButton';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

export type HandoverFormActionsProps = {
  styles: Record<string, any>;
  onSaveDraft: () => void;
  onFinalize: () => void;
  finalizeDisabled: boolean;
  handover: HandoverFormValues;
  onBeforeExport: () => Promise<boolean> | boolean;
};

export const HandoverFormActions: React.FC<HandoverFormActionsProps> = ({
  styles,
  onSaveDraft,
  onFinalize,
  finalizeDisabled,
  handover,
  onBeforeExport,
}) => (
  <>
    <Button title="Guardar borrador" onPress={onSaveDraft} />
    <View style={styles.secondaryButton}>
      <Button title="Finalizar entrega" onPress={onFinalize} disabled={finalizeDisabled} />
    </View>
    <View style={styles.secondaryButton}>
      <ExportPdfButton handover={handover} onBeforeExport={onBeforeExport} />
    </View>
  </>
);
