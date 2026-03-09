import type { HandoverStructuredDiagnosis, NocOutcomeItem, TreatmentItem } from '@/src/types/handover';

import {
  MINIMUM_VIABLE_NNN_MAPPING,
  NOC_SCORE_COMPONENT_CODES,
} from '@/src/lib/fhir-terminology';

export type Coding = {
  system: string;
  code: string;
  display?: string;
};

export type CodeableConcept = {
  coding: Coding[];
  text?: string;
};

export type Reference = {
  reference: string;
  type?: string;
  display?: string;
  identifier?: { system: string; value: string };
};

export type Annotation = {
  text: string;
};

export type Period = {
  start: string;
  end?: string;
};

export type ObservationComponent = {
  code: CodeableConcept;
  valueInteger?: number;
};

export type Condition = {
  resourceType: 'Condition';
  clinicalStatus: CodeableConcept;
  verificationStatus: CodeableConcept;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
};

export type Procedure = {
  resourceType: 'Procedure';
  identifier?: Array<{ system: string; value: string }>;
  status: 'completed' | 'in-progress';
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  note?: Annotation[];
  performedDateTime?: string;
  performedPeriod?: Period;
};

export type Observation = {
  resourceType: 'Observation';
  status: 'final';
  category: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
  issued?: string;
  valueString?: string;
  component?: ObservationComponent[];
};

export type NandaContext = {
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
  clinicalStatus: CodeableConcept;
  verificationStatus: CodeableConcept;
  problemListCategory: CodeableConcept;
};

export function mapNandaConditions(
  diagnoses: HandoverStructuredDiagnosis[],
  context: NandaContext,
): Condition[] {
  return diagnoses
    .filter((item) => item.system === 'NANDA')
    .map((item) => ({
      resourceType: 'Condition',
      clinicalStatus: context.clinicalStatus,
      verificationStatus: context.verificationStatus,
      category: [context.problemListCategory],
      code: {
        coding: [
          {
            system: MINIMUM_VIABLE_NNN_MAPPING.nanda.system,
            code: item.code,
            display: item.display,
          },
        ],
        text: item.display,
      },
      subject: context.subject,
      encounter: context.encounter,
      onsetDateTime: context.effectiveDateTime,
      recordedDate: context.effectiveDateTime,
    }));
}

export function mapLegacyNursingCondition(
  legacyText: string,
  context: NandaContext,
): Condition | null {
  const normalized = legacyText.trim();
  if (!normalized) {
    return null;
  }

  return {
    resourceType: 'Condition',
    clinicalStatus: context.clinicalStatus,
    verificationStatus: context.verificationStatus,
    category: [context.problemListCategory],
    code: { coding: [], text: normalized },
    subject: context.subject,
    encounter: context.encounter,
    onsetDateTime: context.effectiveDateTime,
    recordedDate: context.effectiveDateTime,
  };
}

export function buildNicProcedure(
  treatment: TreatmentItem,
  options: {
    display: string;
    subject: Reference;
    encounter?: Reference;
    localSystem: string;
  },
): Procedure {
  const nicCoding =
    treatment.code?.system === 'NIC' && treatment.code.code.trim() && treatment.code.display.trim()
      ? {
          system: MINIMUM_VIABLE_NNN_MAPPING.nic.system,
          code: treatment.code.code.trim(),
          display: treatment.code.display.trim(),
        }
      : null;

  const procedure: Procedure = {
    resourceType: 'Procedure',
    identifier: [{ system: 'urn:handover-pro:treatment-item', value: treatment.id }],
    status: treatment.done ? 'completed' : 'in-progress',
    code: {
      coding: [
        {
          system: options.localSystem,
          code: treatment.type,
          display: options.display,
        },
        ...(nicCoding ? [nicCoding] : []),
      ],
      text: nicCoding?.display ?? options.display,
    },
    subject: options.subject,
    encounter: options.encounter,
    note: treatment.description ? [{ text: treatment.description }] : undefined,
  };

  if (treatment.done && treatment.scheduledAt) {
    procedure.performedDateTime = treatment.scheduledAt;
  } else if (treatment.scheduledAt) {
    procedure.performedPeriod = { start: treatment.scheduledAt };
  }

  return procedure;
}

export function normalizeNocScore(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return undefined;
  return rounded;
}

export function buildNocOutcomeObservation(
  item: NocOutcomeItem,
  options: {
    subject: Reference;
    encounter?: Reference;
    effectiveDateTime: string;
    category: CodeableConcept;
  },
): Observation | null {
  const nocCode = typeof item?.nocCode === 'string' ? item.nocCode.trim() : '';
  const nocDisplay = typeof item?.nocDisplay === 'string' ? item.nocDisplay.trim() : '';
  const baseline = normalizeNocScore(item?.baseline);
  const target = normalizeNocScore(item?.target);
  const current = normalizeNocScore(item?.current);

  if (!nocCode || !nocDisplay || baseline == null || target == null) {
    return null;
  }

  const component: ObservationComponent[] = [
    {
      code: {
        coding: [NOC_SCORE_COMPONENT_CODES.baseline],
        text: NOC_SCORE_COMPONENT_CODES.baseline.display,
      },
      valueInteger: baseline,
    },
    {
      code: {
        coding: [NOC_SCORE_COMPONENT_CODES.target],
        text: NOC_SCORE_COMPONENT_CODES.target.display,
      },
      valueInteger: target,
    },
  ];

  if (current != null) {
    component.push({
      code: {
        coding: [NOC_SCORE_COMPONENT_CODES.current],
        text: NOC_SCORE_COMPONENT_CODES.current.display,
      },
      valueInteger: current,
    });
  }

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [options.category],
    code: {
      coding: [{ system: MINIMUM_VIABLE_NNN_MAPPING.noc.system, code: nocCode, display: nocDisplay }],
      text: nocDisplay,
    },
    subject: options.subject,
    encounter: options.encounter,
    effectiveDateTime: options.effectiveDateTime,
    issued: options.effectiveDateTime,
    valueString: `NOC ${nocCode}: ${nocDisplay}`,
    component,
  };
}
