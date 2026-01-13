import React from 'react';
import { View } from 'react-native';
import { ExportPdfButton } from '../components/ExportPdfButton';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import BotonPrimario from '../../components/BotonPrimario';

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
    <BotonPrimario label="Guardar borrador" onPress={onSaveDraft} />
    <View style={styles.secondaryButton}>
      <BotonPrimario
        label="Finalizar entrega"
        onPress={onFinalize}
        disabled={finalizeDisabled}
      />
    </View>
    <View style={styles.secondaryButton}>
      <ExportPdfButton handover={handover} onBeforeExport={onBeforeExport} />
    </View>
  </>
);
