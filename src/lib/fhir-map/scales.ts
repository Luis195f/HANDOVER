import type { BradenScale, PainAssessment, RiskItem, GlasgowScale } from '../../types/handover';
import { FHIR_CODES, TERMINOLOGY_SYSTEMS, type TerminologyCode } from '../codes';
import type {
  BuildOptions,
  CodeableConcept,
  Condition,
  MappingContext,
  Observation,
  ObservationComponent,
} from '../fhir-map';

export type ScalesMapperDependencies = {
  codeableConceptFromCode: (
    code: TerminologyCode<string>,
    overrideText?: string,
  ) => CodeableConcept;
  surveyCategoryConcept: CodeableConcept;
  conditionClinicalStatusActive: CodeableConcept;
  conditionVerificationStatusUnconfirmed: CodeableConcept;
  conditionProblemListCategory: CodeableConcept;
  riskCodeMap: Partial<Record<RiskItem['type'], TerminologyCode<string>>>;
};

export function mapEvaObservationImpl(
  deps: ScalesMapperDependencies,
  pain: PainAssessment | undefined,
  context: MappingContext,
): Observation | null {
  if (!pain) return null;

  const components: ObservationComponent[] = [];
  const note: NonNullable<Observation['note']> = [{ text: `Dolor reportado: ${pain.hasPain ? 'Sí' : 'No'}` }];

  if (pain.location) {
    components.push({
      code: {
        coding: [
          { system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'pain-location', display: 'Pain location' },
        ],
        text: 'Pain location',
      },
      valueString: pain.location,
    });
  }

  if (pain.actionsTaken) {
    components.push({
      code: {
        coding: [
          { system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'pain-actions', display: 'Actions taken' },
        ],
        text: 'Actions taken',
      },
      valueString: pain.actionsTaken,
    });
  }

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(FHIR_CODES.SCALES.EVA, 'Escala EVA del dolor'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    valueInteger: pain.evaScore ?? undefined,
    component: components.length > 0 ? components : undefined,
    note,
  };
}

export function mapBradenObservationImpl(
  deps: ScalesMapperDependencies,
  braden: BradenScale | undefined,
  context: MappingContext,
): Observation | null {
  if (!braden) return null;

  const components: ObservationComponent[] = [
    {
      code: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN,
            code: 'sensory-perception',
            display: 'Sensory perception',
          },
        ],
        text: 'Sensory perception',
      },
      valueInteger: braden.sensoryPerception,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN, code: 'moisture', display: 'Moisture' }],
        text: 'Moisture',
      },
      valueInteger: braden.moisture,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN, code: 'activity', display: 'Activity' }],
        text: 'Activity',
      },
      valueInteger: braden.activity,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN, code: 'mobility', display: 'Mobility' }],
        text: 'Mobility',
      },
      valueInteger: braden.mobility,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN, code: 'nutrition', display: 'Nutrition' }],
        text: 'Nutrition',
      },
      valueInteger: braden.nutrition,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_BRADEN, code: 'friction-shear', display: 'Friction/shear' }],
        text: 'Friction/shear',
      },
      valueInteger: braden.frictionShear,
    },
  ];

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(FHIR_CODES.SCALES.BRADEN, 'Escala de Braden'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    valueInteger: braden.totalScore,
    component: components,
    note: [{ text: `Nivel de riesgo: ${braden.riskLevel}` }],
  };
}

export function mapGlasgowObservationImpl(
  deps: ScalesMapperDependencies,
  glasgow: GlasgowScale | undefined,
  context: MappingContext,
): Observation | null {
  if (!glasgow) return null;

  const components: ObservationComponent[] = [
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_GLASGOW, code: 'eye', display: 'Respuesta ocular' }],
        text: 'Respuesta ocular',
      },
      valueInteger: glasgow.eye,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_GLASGOW, code: 'verbal', display: 'Respuesta verbal' }],
        text: 'Respuesta verbal',
      },
      valueInteger: glasgow.verbal,
    },
    {
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_GLASGOW, code: 'motor', display: 'Respuesta motora' }],
        text: 'Respuesta motora',
      },
      valueInteger: glasgow.motor,
    },
  ];

  return {
    resourceType: 'Observation',
    status: 'final',
    category: [deps.surveyCategoryConcept],
    code: deps.codeableConceptFromCode(FHIR_CODES.SCALES.GLASGOW, 'Escala de Glasgow'),
    subject: context.subject,
    encounter: context.encounter,
    effectiveDateTime: context.effectiveDateTime,
    valueQuantity: {
      value: glasgow.total,
      unit: 'score',
    },
    component: components,
    note: [{ text: `Severidad: ${glasgow.severity}` }],
  };
}

export function mapRiskConditionsImpl(
  deps: ScalesMapperDependencies,
  risksStructured: RiskItem[] | undefined,
  context: MappingContext,
): Condition[] {
  const activeRisks = (risksStructured ?? []).filter((risk) => risk.present === true);
  if (activeRisks.length === 0) return [];

  const { subject, encounter, effectiveDateTime } = context;

  return activeRisks
    .map((risk) => ({ risk, code: deps.riskCodeMap[risk.type] }))
    .filter((entry): entry is { risk: RiskItem; code: TerminologyCode<string> } => Boolean(entry.code))
    .map((entry) => ({
      resourceType: 'Condition',
      clinicalStatus: deps.conditionClinicalStatusActive,
      verificationStatus: deps.conditionVerificationStatusUnconfirmed,
      category: [deps.conditionProblemListCategory],
      code: deps.codeableConceptFromCode(entry.code),
      subject,
      encounter,
      onsetDateTime: effectiveDateTime,
      recordedDate: effectiveDateTime,
      note: entry.risk.notes ? [{ text: entry.risk.notes }] : undefined,
    }));
}


