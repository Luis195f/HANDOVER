import React from 'react';
import { View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from 'react-native';

import { AdministrativeSection, type AdministrativeSectionProps } from '@/src/components/handover/AdministrativeSection';

import { PatientSection } from '@/src/components/handover/PatientSection';
import TurnContextSection from '../components/TurnContextSection';
import { CollapsibleSection } from '../components/CollapsibleSection';

type StyleRecord = Record<string, TextStyle | ViewStyle>;
type ContextSectionKey = 'turno' | 'paciente';

type Props = {
  styles: StyleRecord;
  sectionRefs: Record<ContextSectionKey, React.RefObject<View | null>>;
  collapsedSections: Record<ContextSectionKey, boolean>;
  onLayout: (key: ContextSectionKey) => (event: LayoutChangeEvent) => void;
  onToggle: (key: ContextSectionKey) => void;
  onScanPress: () => void;
  parseNumericInput: AdministrativeSectionProps['parseNumericInput'];
  dictationState: AdministrativeSectionProps['dictationState'];
  DictationMicButton: AdministrativeSectionProps['DictationMicButton'];
};

export function HandoverContextSections({
  styles,
  sectionRefs,
  collapsedSections,
  onLayout,
  onToggle,
  onScanPress,
  parseNumericInput,
  dictationState,
  DictationMicButton,
}: Props) {
  return (
    <>
      <View ref={sectionRefs.turno} onLayout={onLayout('turno')} style={styles.section}>
        <CollapsibleSection
          title="Datos del turno"
          isCollapsed={collapsedSections.turno}
          onToggle={() => onToggle('turno')}
        >
          <AdministrativeSection
            styles={styles}
            parseNumericInput={parseNumericInput}
            dictationState={dictationState}
            DictationMicButton={DictationMicButton}
          />
          <View style={{ marginTop: 24 }}>
            <TurnContextSection />
          </View>
        </CollapsibleSection>
      </View>

      <View ref={sectionRefs.paciente} onLayout={onLayout('paciente')} style={styles.section}>
        <CollapsibleSection
          title="Paciente"
          isCollapsed={collapsedSections.paciente}
          onToggle={() => onToggle('paciente')}
        >
          <PatientSection styles={styles} onScanPress={onScanPress} />
        </CollapsibleSection>
      </View>
    </>
  );
}
