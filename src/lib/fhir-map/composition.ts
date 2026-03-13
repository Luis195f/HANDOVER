import { BOOLEAN_CODES, type TerminologyCode } from '../codes';
import type { HandoverBedsideChecklist, PsychosocialCare } from '../../types/handover';
import type {
  BuildOptions,
  BundleReferenceIndex,
  CodeableConcept,
  Composition,
  CompositionAttester,
  CompositionValues,
  MappingContext,
  Observation,
  ObservationComponent,
  Reference,
} from '../fhir-map';

export type CompositionMapperDependencies = {
  resolveOptions: (options?: BuildOptions) => { now: () => string } & BuildOptions;
  ensureAuthorReference: (values: { author?: CompositionValues['author'] }) => Reference;
  patientReference: (patientId: string) => Reference;
  encounterReference: (encounterId?: string) => Reference | undefined;
  codeableConceptFromCode: (
    code: TerminologyCode<string>,
    overrideText?: string,
  ) => CodeableConcept;
  administrativeSummaryText: (data: NonNullable<CompositionValues['administrativeData']>) => string;
  attestersFromSignatures: (signatures?: CompositionValues['signatures']) => Array<{ mode: 'professional' | 'legal' | 'official' | 'personal'; time?: string; partyReference?: string; partyDisplay?: string; partyIdentifier?: { system: string; value: string } }>;
  defaultCompositionType: CodeableConcept;
  compositionSectionCodes: {
    administrative: TerminologyCode<string>;
    vitals: TerminologyCode<string>;
    care: TerminologyCode<string>;
    sbar: TerminologyCode<string>;
    bedsideChecklist: TerminologyCode<string>;
    notes: TerminologyCode<string>;
  };
  compositionSectionConcept: (code: string, display: string) => CodeableConcept;
  handoverObservationCodes: {
    administrative: TerminologyCode<string>;
    sbar: TerminologyCode<string>;
    bedsideChecklist: TerminologyCode<string>;
    notes: TerminologyCode<string>;
  };
  surveyCategoryConcept: CodeableConcept;
  warnCompositionSectionOmitted: (section: 'exams' | 'procedures') => void;
};

export function mapAdministrativeObservationImpl(
  deps: CompositionMapperDependencies,
  values: CompositionValues,
  context: MappingContext,
): Observation | null {
  if (!values.administrativeData) return null;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(deps.handoverObservationCodes.administrative),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: deps.administrativeSummaryText(values.administrativeData),
  };
}

export function mapSbarObservationsImpl(
  deps: CompositionMapperDependencies,
  values: CompositionValues,
  context: MappingContext,
): Observation[] {
  const sbar = values.sbar;
  if (!sbar) return [];

  const components: ObservationComponent[] = [];

  const addComponent = (code: string, display: string, value?: string | null) => {
    const trimmed = value?.trim();
    if (!trimmed) return;

    components.push({
      code: {
        coding: [
          {
            system: deps.handoverObservationCodes.sbar.system,
            code,
            display,
          },
        ],
        text: display,
      },
      valueString: trimmed,
    });
  };

  addComponent('situation', 'Situation', sbar.situation);
  addComponent('background', 'Background', sbar.background);
  addComponent('assessment', 'Assessment', sbar.assessment);
  addComponent('recommendation', 'Recommendation', sbar.recommendation);

  if (components.length === 0) return [];

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(deps.handoverObservationCodes.sbar),
      subject: context.subject,
      encounter: context.encounter,
      effectiveDateTime: context.effectiveDateTime,
      issued: context.effectiveDateTime,
      component: components,
    },
  ];
}

export function mapBedsideChecklistObservationImpl(
  deps: CompositionMapperDependencies,
  checklist: HandoverBedsideChecklist,
  context: MappingContext,
): Observation | null {
  if (!checklist) return null;

  const components: ObservationComponent[] = [];
  const notes: NonNullable<Observation['note']> = [];

  Object.entries(checklist).forEach(([key, value]) => {
    if (key === 'bedsideNotes' && typeof value === 'string' && value.trim()) {
      notes.push({ text: value.trim() });
      return;
    }

    if (typeof value === 'boolean') {
      components.push({
        code: {
          coding: [
            {
              system: deps.handoverObservationCodes.bedsideChecklist.system,
              code: key,
              display: key,
            },
          ],
          text: key,
        },
        valueCodeableConcept: {
          coding: [
            {
              system: value ? BOOLEAN_CODES.YES.system : BOOLEAN_CODES.NO.system,
              code: value ? BOOLEAN_CODES.YES.code : BOOLEAN_CODES.NO.code,
              display: value ? BOOLEAN_CODES.YES.display : BOOLEAN_CODES.NO.display,
            },
          ],
          text: value ? 'Yes' : 'No',
        },
      });
    }
  });

  if (components.length === 0 && notes.length === 0) return null;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(deps.handoverObservationCodes.bedsideChecklist),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    component: components.length > 0 ? components : undefined,
    note: notes.length > 0 ? notes : undefined,
  };
}

export function mapSummaryObservationImpl(
  deps: CompositionMapperDependencies,
  summary: string | null | undefined,
  context: MappingContext,
): Observation | null {
  const trimmed = summary?.trim();
  if (!trimmed) return null;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(deps.handoverObservationCodes.notes),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: trimmed,
  };
}

export function mapPsychosocialObservationImpl(
  deps: CompositionMapperDependencies,
  psychosocial: PsychosocialCare | undefined,
  context: MappingContext,
): Observation | null {
  if (!psychosocial) return null;

  const emotionalStatus = psychosocial.emotionalStatus?.trim() || 'Sin novedad';
  const familyVisits = psychosocial.familyVisits ? 'Sí' : 'No';
  const familyNotes = psychosocial.familyNotes?.trim();
  const extra = familyNotes ? ` (${familyNotes})` : '';
  const narrative = `Estado emocional: ${emotionalStatus}. Visitas familiares: ${familyVisits}${extra}.`;

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(deps.handoverObservationCodes.notes, 'Psychosocial notes'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    issued: context.effectiveDateTime,
    valueString: narrative,
  };
}

export function buildCompositionImpl(
  deps: CompositionMapperDependencies,
  values: CompositionValues,
  refs: BundleReferenceIndex,
  options?: BuildOptions,
): Composition {
  const optionsMerged = deps.resolveOptions(options);
  const authorRef = deps.ensureAuthorReference(values);
  const type = values.composition?.type ?? deps.defaultCompositionType;
  const status = values.composition?.status ?? 'final';
  const title = values.composition?.title ?? 'Clinical handover summary';

  const sections: Composition['section'] = [];
  const attesters = [
    ...(values.composition?.attesters ?? []),
    ...deps.attestersFromSignatures(values.signatures),
  ];

  if (refs.administrative.length > 0) {
    sections.push({
      title: 'Administrative',
      code: deps.codeableConceptFromCode(deps.compositionSectionCodes.administrative, 'Administrative'),
      entry: refs.administrative.map((reference) => ({ reference })),
    });
  }

  if (refs.vitals.length > 0) {
    sections.push({
      title: 'Vital signs',
      code: deps.codeableConceptFromCode(deps.compositionSectionCodes.vitals, 'Vital signs'),
      entry: refs.vitals.map((reference) => ({ reference })),
    });
  }

  if (refs.care.length > 0) {
    sections.push({
      title: 'Care / Treatments',
      code: deps.codeableConceptFromCode(deps.compositionSectionCodes.care, 'Care / Treatments'),
      entry: refs.care.map((reference) => ({ reference })),
    });
  }

  if (refs.sbar.length > 0) {
    sections.push({
      title: 'SBAR',
      code: deps.codeableConceptFromCode(deps.compositionSectionCodes.sbar, 'SBAR'),
      entry: refs.sbar.map((reference) => ({ reference })),
    });
  }

  if (refs.bedsideChecklist.length > 0) {
    sections.push({
      title: 'Bedside checklist',
      code: deps.codeableConceptFromCode(deps.compositionSectionCodes.bedsideChecklist, 'Bedside checklist'),
      entry: refs.bedsideChecklist.map((reference) => ({ reference })),
    });
  }

  if (refs.notes.length > 0) {
    sections.push({
      title: 'Notes / Summary',
      code: deps.codeableConceptFromCode(deps.compositionSectionCodes.notes, 'Notes / Summary'),
      entry: refs.notes.map((reference) => ({ reference })),
    });
  }

  if (refs.medications.length > 0) {
    sections.push({
      title: 'Medications',
      code: deps.compositionSectionConcept('medications', 'Medications'),
      entry: refs.medications.map((reference) => ({ reference })),
    });
  }

  if (refs.treatments.length > 0) {
    sections.push({
      title: 'Tratamientos no farmacológicos',
      code: deps.compositionSectionConcept('treatments', 'Non-pharmacological treatments'),
      entry: refs.treatments.map((reference) => ({ reference })),
    });
  }

  if (refs.outcomes.length > 0) {
    sections.push({
      title: 'Resultados esperados (NOC)',
      code: deps.compositionSectionConcept('outcomes', 'NOC outcomes'),
      entry: refs.outcomes.map((reference) => ({ reference })),
    });
  }

  if (refs.exams.length > 0) {
    sections.push({
      title: 'Exámenes',
      code: deps.compositionSectionConcept('exams', 'Exámenes'),
      entry: refs.exams.map((reference) => ({ reference })),
    });
  } else if ((values.sectionSources?.exams ?? 0) > 0) {
    deps.warnCompositionSectionOmitted('exams');
  }

  if (refs.procedures.length > 0) {
    sections.push({
      title: 'Procedimientos',
      code: deps.compositionSectionConcept('procedures', 'Procedimientos'),
      entry: refs.procedures.map((reference) => ({ reference })),
    });
  } else if ((values.sectionSources?.procedures ?? 0) > 0) {
    deps.warnCompositionSectionOmitted('procedures');
  }

  if (refs.oxygen.length > 0) {
    sections.push({
      title: 'Oxygen therapy',
      code: deps.compositionSectionConcept('oxygen', 'Oxygen therapy'),
      entry: refs.oxygen.map((reference) => ({ reference })),
    });
  }

  if (refs.devices.length > 0) {
    sections.push({
      title: 'Devices',
      code: deps.compositionSectionConcept('devices', 'Devices'),
      entry: refs.devices.map((reference) => ({ reference })),
    });
  }

  if (refs.nutrition.length > 0) {
    sections.push({
      title: 'Nutrition',
      code: deps.compositionSectionConcept('nutrition', 'Nutrition'),
      entry: refs.nutrition.map((reference) => ({ reference })),
    });
  }

  if (refs.elimination.length > 0) {
    sections.push({
      title: 'Elimination',
      code: deps.compositionSectionConcept('elimination', 'Elimination'),
      entry: refs.elimination.map((reference) => ({ reference })),
    });
  }

  if (refs.mobilitySkin.length > 0) {
    sections.push({
      title: 'Mobility and Skin',
      code: deps.compositionSectionConcept('mobility-skin', 'Mobility and Skin'),
      entry: refs.mobilitySkin.map((reference) => ({ reference })),
    });
  }

  if (refs.risks.length > 0) {
    sections.push({
      title: 'Risks',
      code: deps.compositionSectionConcept('risks', 'Risks'),
      entry: refs.risks.map((reference) => ({ reference })),
    });
  }

  if (refs.detectedIssues && refs.detectedIssues.length > 0) {
    sections.push({
      title: 'Detected issues',
      code: deps.compositionSectionConcept('detected-issues', 'Detected issues'),
      entry: refs.detectedIssues.map((reference) => ({ reference })),
    });
  }

  if (refs.diagnoses && refs.diagnoses.length > 0) {
    sections.push({
      title: 'Diagnoses',
      code: deps.compositionSectionConcept('diagnoses', 'Diagnoses'),
      entry: refs.diagnoses.map((reference) => ({ reference })),
    });
  }

  if (refs.fluidBalance.length > 0) {
    sections.push({
      title: 'Fluid balance',
      code: deps.compositionSectionConcept('fluid-balance', 'Fluid balance'),
      entry: refs.fluidBalance.map((reference) => ({ reference })),
    });
  }

  if (refs.pain.length > 0) {
    sections.push({
      title: 'Pain assessment',
      code: deps.compositionSectionConcept('pain', 'Pain assessment'),
      entry: refs.pain.map((reference) => ({ reference })),
    });
  }

  if (refs.braden.length > 0) {
    sections.push({
      title: 'Braden scale',
      code: deps.compositionSectionConcept('braden', 'Braden scale'),
      entry: refs.braden.map((reference) => ({ reference })),
    });
  }

  if (refs.glasgow.length > 0) {
    sections.push({
      title: 'Glasgow scale',
      code: deps.compositionSectionConcept('glasgow', 'Glasgow scale'),
      entry: refs.glasgow.map((reference) => ({ reference })),
    });
  }

  if (refs.attachments.length > 0) {
    sections.push({
      title: 'Attachments',
      code: deps.compositionSectionConcept('attachments', 'Attachments'),
      entry: refs.attachments.map((reference) => ({ reference })),
    });
  }

  const subject = deps.patientReference(values.patientId);
  const encounter = values.encounterId ? deps.encounterReference(values.encounterId) : undefined;

  const shiftPeriod =
    values.administrativeData?.shiftStart && values.administrativeData?.shiftEnd
      ? { start: values.administrativeData.shiftStart, end: values.administrativeData.shiftEnd }
      : undefined;

  const now = typeof optionsMerged?.now === 'function' ? optionsMerged.now() : new Date().toISOString();

  return {
    resourceType: 'Composition',
    status,
    type,
    subject,
    encounter,
    author: [authorRef],
    title,
    date: now,
    event: shiftPeriod ? [{ period: shiftPeriod }] : undefined,
    section: sections.length > 0 ? sections : undefined,
    attester: attesters.length > 0 ? (attesters as CompositionAttester[]) : undefined,
  };
}





