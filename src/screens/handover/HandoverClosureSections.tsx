import React from 'react';
import { Text, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from 'react-native';
import { useFormContext } from 'react-hook-form';

import { SignaturePad, type SignaturePadValue } from '@/src/components/SignaturePad';
import { type BedsideChecklistItem } from '@/src/config/bedsideChecklist';
import type { HandoverSignature } from '@/src/types/handover';
import type { HandoverValues } from '@/src/validation/schemas';
import { t } from '@/src/i18n';

import { SummarySection, type SummarySectionProps } from '@/src/components/handover/SummarySection';
import { BedsideChecklistSection } from '../components/BedsideChecklistSection';
import { SignaturesSection, type SignatureUser } from '../components/SignaturesSection';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { HandoverFormActions } from './HandoverFormActions';
import { normalizeSignatureInfo } from './formUtils';

type StyleRecord = Record<string, TextStyle | ViewStyle>;
type ClosureSectionKey = 'resumen' | 'bedsideChecklist' | 'firmas';
type OutgoingSignatureValue = NonNullable<NonNullable<HandoverValues['signatures']>['outgoing']>;

type Props = {
  styles: StyleRecord;
  sectionRefs: Record<ClosureSectionKey, React.RefObject<View | null>>;
  collapsedSections: Record<ClosureSectionKey, boolean>;
  onLayout: (key: ClosureSectionKey) => (event: LayoutChangeEvent) => void;
  onToggle: (key: ClosureSectionKey) => void;
  dictationState: SummarySectionProps['dictationState'];
  DictationMicButton: SummarySectionProps['DictationMicButton'];
  sbarPreview: string | null;
  onGenerateSbar: () => void;
  onInsertSbar: () => void;
  onCloseSbarPreview: () => void;
  checklistItems: BedsideChecklistItem[];
  currentUser?: SignatureUser | null;
  administrativeUnitId?: string;
  canSignOutgoing: boolean;
  allowedSignatureKind?: 'outgoing' | 'incoming';
  buildOutgoingSignature: (payload: SignaturePadValue) => HandoverSignature | null;
  onAttestationCaptured: (kind: 'outgoing' | 'incoming', signature: HandoverSignature) => void;
  outgoingSignatureError?: string;
  incomingSignatureError?: string;
  onSaveDraft: () => void;
  onFinalize: () => void;
  finalizeDisabled: boolean;
  onBeforeExport: () => Promise<boolean> | boolean;
};

export function HandoverClosureSections({
  styles,
  sectionRefs,
  collapsedSections,
  onLayout,
  onToggle,
  dictationState,
  DictationMicButton,
  sbarPreview,
  onGenerateSbar,
  onInsertSbar,
  onCloseSbarPreview,
  checklistItems,
  currentUser,
  administrativeUnitId,
  canSignOutgoing,
  allowedSignatureKind,
  buildOutgoingSignature,
  onAttestationCaptured,
  outgoingSignatureError,
  incomingSignatureError,
  onSaveDraft,
  onFinalize,
  finalizeDisabled,
  onBeforeExport,
}: Props) {
  const form = useFormContext<HandoverValues>();
  const signaturesValue = form.watch('signatures');
  const statusValue = form.watch('status');
  const outgoingSignature = signaturesValue?.outgoing;
  const normalizedSignaturesValue = normalizeSignatureInfo(signaturesValue);

  const handleSignaturePadChange = (payload: SignaturePadValue | null) => {
    if (!payload) {
      const nextSignatures = signaturesValue ? { ...signaturesValue } : undefined;
      if (nextSignatures?.outgoing) {
        delete nextSignatures.outgoing;
      }
      form.setValue(
        'signatures',
        nextSignatures && Object.keys(nextSignatures).length > 0 ? nextSignatures : undefined,
        { shouldDirty: true, shouldValidate: true },
      );
      return;
    }

    const built = buildOutgoingSignature(payload);
    if (!built) return;
    const nextOutgoing: OutgoingSignatureValue = {
      ...built,
      method: built.method ?? 'session',
    };

    form.setValue(
      'signatures',
      normalizeSignatureInfo({
        ...(signaturesValue ?? {}),
        outgoing: nextOutgoing,
      }),
      { shouldDirty: true, shouldValidate: true },
    );
    onAttestationCaptured('outgoing', nextOutgoing);
  };

  return (
    <>
      <View ref={sectionRefs.resumen} onLayout={onLayout('resumen')} style={styles.section}>
        <CollapsibleSection
          title="Resumen / cierre de turno"
          isCollapsed={collapsedSections.resumen}
          onToggle={() => onToggle('resumen')}
        >
          <SummarySection
            styles={styles}
            dictationState={dictationState}
            DictationMicButton={DictationMicButton}
            sbarPreview={sbarPreview}
            onGenerateSbar={onGenerateSbar}
            onInsertSbar={onInsertSbar}
            onCloseSbarPreview={onCloseSbarPreview}
          />
        </CollapsibleSection>
      </View>

      <View ref={sectionRefs.bedsideChecklist} onLayout={onLayout('bedsideChecklist')} style={styles.section}>
        <CollapsibleSection
          title="Bedside Checklist"
          isCollapsed={collapsedSections.bedsideChecklist}
          onToggle={() => onToggle('bedsideChecklist')}
          lazy
          sectionKey="bedsideChecklist"
        >
          <BedsideChecklistSection items={checklistItems} />
        </CollapsibleSection>
      </View>

      <View ref={sectionRefs.firmas} onLayout={onLayout('firmas')} style={styles.section}>
        <CollapsibleSection
          title={t('signatures.sectionTitle')}
          isCollapsed={collapsedSections.firmas}
          onToggle={() => onToggle('firmas')}
        >
          {statusValue === 'final' ? (
            <View style={styles.signaturePadSection}>
              <SignaturePad
                value={
                  outgoingSignature?.imageBase64
                    ? { imageBase64: outgoingSignature.imageBase64, signedAt: outgoingSignature.signedAt }
                    : undefined
                }
                onChange={handleSignaturePadChange}
                disabled={!canSignOutgoing}
              />
              {!canSignOutgoing ? (
                <Text style={styles.signaturePadHint}>{t('signatures.signaturePadDisabledHint')}</Text>
              ) : null}
            </View>
          ) : null}

          <SignaturesSection
            value={normalizedSignaturesValue}
            onChange={(next) => {
              const normalized = normalizeSignatureInfo(next);
              const previousIncomingSignedAt = signaturesValue?.incoming?.signedAt;
              const nextIncoming = normalized?.incoming;
              form.setValue('signatures', normalized, { shouldDirty: true, shouldValidate: true });
              if (nextIncoming && nextIncoming.signedAt !== previousIncomingSignedAt) {
                onAttestationCaptured('incoming', nextIncoming);
              }
            }}
            currentUser={currentUser}
            administrativeUnitId={administrativeUnitId}
            getSignaturePayload={() => form.getValues()}
            disableOutgoingAction
            allowedSignatureKind={allowedSignatureKind}
          />

          {outgoingSignatureError ? <Text style={styles.error}>{outgoingSignatureError}</Text> : null}
          {incomingSignatureError ? <Text style={styles.error}>{incomingSignatureError}</Text> : null}
        </CollapsibleSection>
      </View>

      <View style={styles.buttonRow}>
        <HandoverFormActions
          styles={styles}
          onSaveDraft={onSaveDraft}
          onFinalize={onFinalize}
          finalizeDisabled={finalizeDisabled}
          handover={form.getValues()}
          onBeforeExport={onBeforeExport}
        />
      </View>
    </>
  );
}
