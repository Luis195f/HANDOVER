import React from 'react';
import { View } from 'react-native';
import { ExportPdfButton } from '../components/ExportPdfButton';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { PrimaryButton } from '../../components/PrimaryButton';
import { t } from '@/src/i18n';

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
    <PrimaryButton
      label={t('handover.actions.saveDraft')}
      onPress={onSaveDraft}
      testID="handover-save-draft"
    />
    <View style={styles.secondaryButton}>
      <PrimaryButton
        label={t('handover.actions.finalize')}
        onPress={onFinalize}
        disabled={finalizeDisabled}
        testID="handover-finalize"
      />
    </View>
    <View style={styles.secondaryButton}>
      <ExportPdfButton handover={handover} onBeforeExport={onBeforeExport} />
    </View>
  </>
);
