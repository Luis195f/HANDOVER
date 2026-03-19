import type {
  ContingencyPlan,
  EliminationInfo,
  ExamItem,
  FluidBalanceInfo,
  MobilityInfo,
  NutritionInfo,
  PendingTask,
  ProcedureItem,
  SkinInfo,
  TurnContext,
  TreatmentItem,
} from '../../types/handover';
import { BOOLEAN_CODES, CATEGORY, EXAM_CODES, FHIR_CODES, TERMINOLOGY_SYSTEMS, type TerminologyCode } from '../codes';
import { buildNicProcedure, buildNocOutcomeObservation } from './nnn';
import { normalizeTextValue, normalizeStringList } from './shared';
import type {
  BuildOptions,
  CodeableConcept,
  Observation,
  ObservationComponent,
  OutcomeValues,
  Procedure,
  Reference,
} from '../fhir-map';

export type SpecificCareMapperDependencies = {
  resolveOptions: (options?: BuildOptions) => { now: () => string } & BuildOptions;
  patientReference: (patientId: string) => Reference;
  encounterReference: (encounterId?: string) => Reference | undefined;
  codeableConceptFromCode: (
    code: TerminologyCode<string>,
    overrideText?: string,
  ) => CodeableConcept;
  quantity: (value: number, unit: string, code: string) => Observation['valueQuantity'];
  surveyCategoryConcept: CodeableConcept;
  outcomeCategoryConcept: CodeableConcept;
  warnExamsItemSkipped: (payload: {
    code: 'HANDOVER_EXAMS_ITEM_SKIPPED';
    reason: 'invalid_shape' | 'empty_description' | 'unknown_type' | 'unknown_state';
    examType?: string;
    examState?: string;
    len?: number;
  }) => void;
  warnProceduresItemSkipped: (payload: {
    code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED';
    reason: 'invalid_shape' | 'empty_description';
    done?: boolean;
    len?: number;
  }) => void;
};

type CareValues = { patientId: string; encounterId?: string };
type TreatmentValues = CareValues & { treatments?: TreatmentItem[] };

type NormalizedExamInput = {
  items: Array<ExamItem | unknown>;
  legacyFields: string[];
  legacyCount: number;
  inputCount: number;
};

const isExamType = (value: unknown): value is ExamItem['type'] =>
  value === 'laboratory' || value === 'imaging' || value === 'other';

const isExamState = (value: unknown): value is ExamItem['state'] =>
  value === 'result' || value === 'pending';

const TREATMENT_TYPE_LABELS: Record<TreatmentItem['type'], string> = {
  woundCare: 'Curación de heridas',
  respiratory: 'Respiratorio',
  mobilization: 'Movilización',
  education: 'Educación',
  other: 'Otro',
};

const TURN_CONTEXT_PHASE_LABELS: Record<NonNullable<TurnContext['shiftPhase']>, string> = {
  start: 'Inicio',
  mid: 'Mitad',
  closing: 'Cierre',
  coverage: 'Cobertura',
};

const TURN_CONTEXT_WORKLOAD_LABELS: Record<NonNullable<TurnContext['workload']>, string> = {
  stable: 'Estable',
  high: 'Alta demanda',
  saturated: 'Saturado',
  contingency: 'Contingencia',
};

const PENDING_TASK_CATEGORY_LABELS: Record<PendingTask['category'], string> = {
  'critical-task': 'Pendiente crítico',
  reevaluation: 'Reevaluación',
  'exam-followup': 'Examen',
  'procedure-followup': 'Procedimiento',
  escalation: 'Escalado',
  other: 'Otro',
};

const PENDING_TASK_PRIORITY_LABELS: Record<NonNullable<PendingTask['priority']>, string> = {
  routine: 'Rutina',
  urgent: 'Urgente',
  critical: 'Crítico',
};

const PENDING_TASK_STATUS_LABELS: Record<NonNullable<PendingTask['status']>, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Resuelto',
};

const buildStringComponent = (code: string, display: string, value?: string): ObservationComponent | null => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return null;
  return {
    code: {
      coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code, display }],
      text: display,
    },
    valueString: normalized,
  };
};
export const normalizeExamInputs = (values: { exams?: unknown; examsPending?: unknown }): NormalizedExamInput => {
  const items: Array<ExamItem | unknown> = [];
  const legacyFields = new Set<string>();
  let legacyCount = 0;

  const pushLegacyStrings = (input: unknown, state: ExamItem['state'], field: string) => {
    if (input === undefined || input === null) return;
    legacyFields.add(field);
    const list = Array.isArray(input) ? input : [input];
    normalizeStringList(list).forEach((entry) => {
      items.push({ type: 'other', state, description: entry });
      legacyCount += 1;
    });
  };

  if (Array.isArray(values.exams)) {
    values.exams.forEach((entry) => {
      if (typeof entry === 'string') {
        legacyFields.add('exams');
        const trimmed = entry.trim();
        if (trimmed) {
          items.push({ type: 'other', state: 'result', description: trimmed });
          legacyCount += 1;
        }
        return;
      }
      items.push(entry);
    });
  } else if (values.exams && typeof values.exams === 'object') {
    items.push(values.exams as ExamItem);
  } else {
    pushLegacyStrings(values.exams, 'result', 'exams');
  }

  pushLegacyStrings((values as { examsPending?: unknown }).examsPending, 'pending', 'examsPending');

  return { items, legacyFields: Array.from(legacyFields), legacyCount, inputCount: items.length };
};

export function mapNutritionCareImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { nutrition?: NutritionInfo },
  options?: BuildOptions,
): Observation[] {
  if (!values.nutrition) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  const components: ObservationComponent[] = [
    {
      code: { coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'diet-type', display: 'Diet type' }], text: 'Diet type' },
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_DIET,
            code: values.nutrition.dietType,
            display: values.nutrition.dietType,
          },
        ],
        text: values.nutrition.dietType,
      },
    },
  ];

  if (values.nutrition.tolerance) {
    components.push({
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'tolerance', display: 'Tolerance' }],
        text: 'Tolerance',
      },
      valueString: values.nutrition.tolerance,
    });
  }

  if (values.nutrition.intakeMl !== undefined) {
    components.push({
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'intake', display: 'Intake (mL)' }],
        text: 'Intake (mL)',
      },
      valueQuantity: deps.quantity(values.nutrition.intakeMl, 'mL', 'mL'),
    });
  }

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.NUTRITION),
      subject,
      encounter,
      effectiveDateTime,
      component: components,
    },
  ];
}

export function mapEliminationCareImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { elimination?: EliminationInfo },
  options?: BuildOptions,
): Observation[] {
  if (!values.elimination) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();
  const observations: Observation[] = [];

  if (values.elimination.urineMl !== undefined) {
    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.URINE_OUTPUT),
      subject,
      encounter,
      effectiveDateTime,
      valueQuantity: deps.quantity(values.elimination.urineMl, 'mL', 'mL'),
    });
  }

  if (values.elimination.stoolPattern) {
    const note = values.elimination.hasRectalTube !== undefined
      ? [
          {
            text: values.elimination.hasRectalTube ? 'Rectal tube present' : 'No rectal tube',
          },
        ]
      : undefined;

    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.STOOL_PATTERN),
      subject,
      encounter,
      effectiveDateTime,
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_STOOL_PATTERN,
            code: values.elimination.stoolPattern,
            display: values.elimination.stoolPattern,
          },
        ],
        text: values.elimination.stoolPattern,
      },
      note,
    });
  } else if (values.elimination.hasRectalTube !== undefined) {
    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.RECTAL_TUBE),
      subject,
      encounter,
      effectiveDateTime,
      valueCodeableConcept: {
        coding: [
          {
            system: values.elimination.hasRectalTube ? BOOLEAN_CODES.YES.system : BOOLEAN_CODES.NO.system,
            code: values.elimination.hasRectalTube ? BOOLEAN_CODES.YES.code : BOOLEAN_CODES.NO.code,
            display: values.elimination.hasRectalTube ? 'Present' : 'Absent',
          },
        ],
        text: values.elimination.hasRectalTube ? 'Present' : 'Absent',
      },
    });
  }

  return observations;
}

export function mapMobilitySkinCareImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { mobility?: MobilityInfo; skin?: SkinInfo },
  options?: BuildOptions,
): Observation[] {
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();
  const observations: Observation[] = [];

  if (values.mobility) {
    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.MOBILITY),
      subject,
      encounter,
      effectiveDateTime,
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_MOBILITY_LEVEL,
            code: values.mobility.mobilityLevel,
            display: values.mobility.mobilityLevel,
          },
        ],
        text: values.mobility.mobilityLevel,
      },
      note: values.mobility.repositioningPlan
        ? [{ text: `Repositioning plan: ${values.mobility.repositioningPlan}` }]
        : undefined,
    });
  }

  if (values.skin) {
    const components: ObservationComponent[] = [];
    if (values.skin.hasPressureInjury !== undefined) {
      components.push({
        code: {
          coding: [
            { system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'pressure-injury', display: 'Pressure injury' },
          ],
          text: 'Pressure injury',
        },
        valueCodeableConcept: {
          coding: [
            {
              system: values.skin.hasPressureInjury ? BOOLEAN_CODES.YES.system : BOOLEAN_CODES.NO.system,
              code: values.skin.hasPressureInjury ? BOOLEAN_CODES.YES.code : BOOLEAN_CODES.NO.code,
              display: values.skin.hasPressureInjury ? 'Present' : 'Absent',
            },
          ],
          text: values.skin.hasPressureInjury ? 'Present' : 'Absent',
        },
      });
    }

    observations.push({
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.SKIN),
      subject,
      encounter,
      effectiveDateTime,
      valueString: values.skin.skinStatus,
      component: components.length > 0 ? components : undefined,
    });
  }

  return observations;
}

export function mapFluidBalanceCareImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { fluidBalance?: FluidBalanceInfo },
  options?: BuildOptions,
): Observation[] {
  if (!values.fluidBalance) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  const components: ObservationComponent[] = [];

  components.push({
    code: { coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'intake', display: 'Intake' }], text: 'Intake' },
    valueQuantity: deps.quantity(values.fluidBalance.intakeMl, 'mL', 'mL'),
  });

  components.push({
    code: { coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'output', display: 'Output' }], text: 'Output' },
    valueQuantity: deps.quantity(values.fluidBalance.outputMl, 'mL', 'mL'),
  });

  const net =
    values.fluidBalance.netBalanceMl !== undefined
      ? values.fluidBalance.netBalanceMl
      : values.fluidBalance.intakeMl - values.fluidBalance.outputMl;

  if (Number.isFinite(net)) {
    components.push({
      code: { coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'net', display: 'Net balance' }], text: 'Net balance' },
      valueQuantity: deps.quantity(net as number, 'mL', 'mL'),
    });
  }

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.FLUID_BALANCE),
      subject,
      encounter,
      effectiveDateTime,
      component: components,
      note: values.fluidBalance.notes ? [{ text: values.fluidBalance.notes }] : undefined,
    },
  ];
}

export function mapTreatmentsImpl(
  deps: SpecificCareMapperDependencies,
  values: TreatmentValues,
  _options?: BuildOptions,
): Procedure[] {
  if (!values.treatments || values.treatments.length === 0) return [];
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);

  return values.treatments.map(
    (treatment) =>
      buildNicProcedure(treatment, {
        display: TREATMENT_TYPE_LABELS[treatment.type],
        subject,
        encounter,
        localSystem: TERMINOLOGY_SYSTEMS.HANDOVER_TREATMENT_TYPE,
      }) as Procedure,
  );
}

export function mapNocOutcomesImpl(
  deps: SpecificCareMapperDependencies,
  values: OutcomeValues,
  options?: BuildOptions,
): Observation[] {
  if (!values.outcomes || values.outcomes.length === 0) return [];

  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  return values.outcomes.flatMap((item) => {
    const observation = buildNocOutcomeObservation(item, {
      subject,
      encounter,
      effectiveDateTime,
      category: deps.outcomeCategoryConcept,
    });
    return observation ? [observation as Observation] : [];
  });
}

export function mapExamObservationsImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { exams?: ExamItem[]; examsPending?: unknown },
  options?: BuildOptions,
  normalizedInput?: NormalizedExamInput,
): Observation[] {
  const normalizedExams = normalizedInput ?? normalizeExamInputs(values);

  if (normalizedExams.inputCount === 0) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  const categoryByType: Record<ExamItem['type'], CodeableConcept | undefined> = {
    laboratory: {
      coding: [CATEGORY.laboratory],
      text: CATEGORY.laboratory.display,
    },
    imaging: {
      coding: [CATEGORY.imaging],
      text: CATEGORY.imaging.display,
    },
    other: {
      coding: [CATEGORY.survey],
      text: CATEGORY.survey.display,
    },
  };

  const statusByState: Record<ExamItem['state'], Observation['status']> = {
    result: 'final',
    pending: 'registered',
  };
  const codeByType: Record<ExamItem['type'], CodeableConcept> = {
    laboratory: { coding: [EXAM_CODES.LABORATORY], text: EXAM_CODES.LABORATORY.display },
    imaging: { coding: [EXAM_CODES.IMAGING], text: EXAM_CODES.IMAGING.display },
    other: { coding: [EXAM_CODES.OTHER], text: EXAM_CODES.OTHER.display },
  };
  return normalizedExams.items.flatMap((exam) => {
    const descriptionRaw = (exam as ExamItem | Record<string, unknown>)?.description;
    const description = normalizeTextValue(descriptionRaw);
    const len = typeof descriptionRaw === 'string' ? description.length : undefined;
    const examType = (exam as ExamItem | Record<string, unknown>)?.type as ExamItem['type'] | undefined;
    const examState = (exam as ExamItem | Record<string, unknown>)?.state as ExamItem['state'] | undefined;

    if (!exam || typeof exam !== 'object' || examType === undefined || examState === undefined) {
      deps.warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'invalid_shape',
        examType: typeof examType === 'string' ? examType : undefined,
        examState: typeof examState === 'string' ? examState : undefined,
        len,
      });
      return [];
    }

    if (!description) {
      deps.warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'empty_description',
        examType: typeof examType === 'string' ? examType : undefined,
        examState: typeof examState === 'string' ? examState : undefined,
        len: len ?? 0,
      });
      return [];
    }

    if (!isExamType(examType)) {
      deps.warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'unknown_type',
        examType: typeof examType === 'string' ? examType : undefined,
        examState: typeof examState === 'string' ? examState : undefined,
        len,
      });
      return [];
    }

    if (!isExamState(examState)) {
      deps.warnExamsItemSkipped({
        code: 'HANDOVER_EXAMS_ITEM_SKIPPED',
        reason: 'unknown_state',
        examType,
        examState: typeof examState === 'string' ? examState : undefined,
        len,
      });
      return [];
    }
    const examItem = exam as ExamItem;
    const notes = [
      buildStringComponent('exam-priority', 'Exam priority', examItem.priority),
      buildStringComponent('exam-due-by', 'Exam due by', examItem.dueBy),
      buildStringComponent('exam-responsible', 'Exam responsible', examItem.responsible),
    ]
      .filter((component): component is ObservationComponent => Boolean(component))
      .map((component) => ({ text: `${component.code.text}: ${component.valueString}` }));

    return [
      {
        resourceType: 'Observation',
        status: statusByState[examState],
        category: categoryByType[examType] ? [categoryByType[examType] as CodeableConcept] : [],
        code: codeByType[examType],
        valueString: description,
        subject,
        encounter,
        effectiveDateTime,
        note: notes.length > 0 ? notes : undefined,
      },
    ];
  });
}

export function mapProceduresImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { procedures?: ProcedureItem[] },
  options?: BuildOptions,
): Procedure[] {
  const procedures = Array.isArray(values.procedures)
    ? values.procedures
    : values.procedures !== undefined && values.procedures !== null
      ? ([values.procedures] as Array<ProcedureItem | unknown>)
      : [];
  if (procedures.length === 0) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const performedDateTime = optionsMerged.now();

  return procedures.flatMap((procedure) => {
    if (!procedure || typeof procedure !== 'object') {
      deps.warnProceduresItemSkipped({
        code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED',
        reason: 'invalid_shape',
        done: undefined,
      });
      return [];
    }

    const descriptionRaw = (procedure as ProcedureItem | Record<string, unknown>).description;
    const description = normalizeTextValue(descriptionRaw);
    const len = typeof descriptionRaw === 'string' ? description.length : undefined;
    const doneRaw = (procedure as ProcedureItem | Record<string, unknown>).done;

    if (doneRaw !== undefined && typeof doneRaw !== 'boolean') {
      deps.warnProceduresItemSkipped({
        code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED',
        reason: 'invalid_shape',
        done: undefined,
        len,
      });
      return [];
    }

    if (!description) {
      deps.warnProceduresItemSkipped({
        code: 'HANDOVER_PROCEDURES_ITEM_SKIPPED',
        reason: 'empty_description',
        done: typeof doneRaw === 'boolean' ? doneRaw : undefined,
        len: len ?? 0,
      });
      return [];
    }

    const procedureItem = procedure as ProcedureItem;
    const done = doneRaw === true;
    const noteLines = [
      procedureItem.priority ? `Priority: ${procedureItem.priority}` : undefined,
      normalizeTextValue(procedureItem.scheduledFor) ? `Scheduled for: ${procedureItem.scheduledFor}` : undefined,
      normalizeTextValue(procedureItem.responsible) ? `Responsible: ${procedureItem.responsible}` : undefined,
      normalizeTextValue(procedureItem.escalationCriteria)
        ? `Escalation: ${procedureItem.escalationCriteria}`
        : undefined,
    ].filter((item): item is string => Boolean(item));
    return [
      {
        resourceType: 'Procedure',
        status: done ? 'completed' : 'preparation',
        code: {
          coding: [
            {
              system: 'urn:handover-pro:procedure',
              code: done ? 'completed' : 'planned',
              display: 'Procedure',
            },
          ],
          text: description,
        },
        subject,
        encounter,
        performedDateTime: done ? performedDateTime : undefined,
        note: noteLines.length > 0 ? noteLines.map((text) => ({ text })) : undefined,
      },
    ];
  });
}




export function mapTurnContextObservationImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { turnContext?: TurnContext },
  options?: BuildOptions,
): Observation[] {
  if (!values.turnContext) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();
  const components: ObservationComponent[] = [];

  if (values.turnContext.shiftPhase) {
    components.push({
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'shift-phase', display: 'Shift phase' }],
        text: 'Shift phase',
      },
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_TURN_CONTEXT,
            code: values.turnContext.shiftPhase,
            display: TURN_CONTEXT_PHASE_LABELS[values.turnContext.shiftPhase],
          },
        ],
        text: TURN_CONTEXT_PHASE_LABELS[values.turnContext.shiftPhase],
      },
    });
  }

  if (values.turnContext.workload) {
    components.push({
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'workload', display: 'Workload' }],
        text: 'Workload',
      },
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_TURN_CONTEXT,
            code: values.turnContext.workload,
            display: TURN_CONTEXT_WORKLOAD_LABELS[values.turnContext.workload],
          },
        ],
        text: TURN_CONTEXT_WORKLOAD_LABELS[values.turnContext.workload],
      },
    });
  }

  const operationalSummaryComponent = buildStringComponent(
    'operational-summary',
    'Operational summary',
    values.turnContext.operationalSummary,
  );
  if (operationalSummaryComponent) {
    components.push(operationalSummaryComponent);
  }

  (values.turnContext.serviceIncidents ?? []).forEach((incident) => {
    const encoded = `${incident.kind}|${incident.severity}|${incident.resolved ? 'resolved' : 'open'}|${incident.description}`;
    const component = buildStringComponent('service-incident', 'Service incident', encoded);
    if (component) {
      components.push(component);
    }
  });

  if (components.length === 0) return [];

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.TURN_CONTEXT),
      subject,
      encounter,
      effectiveDateTime,
      component: components,
    },
  ];
}

export function mapPendingTaskObservationsImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { pendingTasks?: PendingTask[] },
  options?: BuildOptions,
): Observation[] {
  if (!values.pendingTasks || values.pendingTasks.length === 0) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();

  return values.pendingTasks.map((task) => {
    const components: ObservationComponent[] = [];

    components.push({
      code: {
        coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'task-category', display: 'Task category' }],
        text: 'Task category',
      },
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.HANDOVER_TASK_CATEGORY,
            code: task.category,
            display: PENDING_TASK_CATEGORY_LABELS[task.category],
          },
        ],
        text: PENDING_TASK_CATEGORY_LABELS[task.category],
      },
    });

    if (task.priority) {
      components.push({
        code: {
          coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'task-priority', display: 'Task priority' }],
          text: 'Task priority',
        },
        valueCodeableConcept: {
          coding: [
            {
              system: TERMINOLOGY_SYSTEMS.HANDOVER_TASK_PRIORITY,
              code: task.priority,
              display: PENDING_TASK_PRIORITY_LABELS[task.priority],
            },
          ],
          text: PENDING_TASK_PRIORITY_LABELS[task.priority],
        },
      });
    }

    if (task.status) {
      components.push({
        code: {
          coding: [{ system: TERMINOLOGY_SYSTEMS.HANDOVER_COMPONENT, code: 'task-status', display: 'Task status' }],
          text: 'Task status',
        },
        valueCodeableConcept: {
          coding: [
            {
              system: TERMINOLOGY_SYSTEMS.HANDOVER_TASK_STATUS,
              code: task.status,
              display: PENDING_TASK_STATUS_LABELS[task.status],
            },
          ],
          text: PENDING_TASK_STATUS_LABELS[task.status],
        },
      });
    }

    [
      buildStringComponent('due-by', 'Due by', task.dueBy),
      buildStringComponent('owner', 'Owner', task.owner),
      buildStringComponent('escalation-criteria', 'Escalation criteria', task.escalationCriteria),
    ].forEach((component) => {
      if (component) {
        components.push(component);
      }
    });

    return {
      resourceType: 'Observation',
      status: task.status === 'done' ? 'final' : 'registered',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.PENDING_TASK),
      subject,
      encounter,
      effectiveDateTime,
      valueString: task.title,
      component: components,
      note: task.notes ? [{ text: task.notes }] : undefined,
    };
  });
}

export function mapContingencyPlanObservationImpl(
  deps: SpecificCareMapperDependencies,
  values: CareValues & { contingencyPlan?: ContingencyPlan },
  options?: BuildOptions,
): Observation[] {
  if (!values.contingencyPlan) return [];
  const optionsMerged = deps.resolveOptions(options);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effectiveDateTime = optionsMerged.now();
  const components: ObservationComponent[] = [];

  (values.contingencyPlan.watchItems ?? []).forEach((item) => {
    const component = buildStringComponent('watch-item', 'Watch item', item);
    if (component) components.push(component);
  });
  (values.contingencyPlan.immediateActions ?? []).forEach((item) => {
    const component = buildStringComponent('immediate-action', 'Immediate action', item);
    if (component) components.push(component);
  });
  (values.contingencyPlan.escalationCriteria ?? []).forEach((item) => {
    const component = buildStringComponent('escalation-criteria', 'Escalation criteria', item);
    if (component) components.push(component);
  });

  [
    buildStringComponent('escalation-contact', 'Escalation contact', values.contingencyPlan.escalationContact),
    buildStringComponent('fallback-plan', 'Fallback plan', values.contingencyPlan.fallbackPlan),
  ].forEach((component) => {
    if (component) components.push(component);
  });

  if (components.length === 0) return [];

  return [
    {
      resourceType: 'Observation',
      status: 'final',
      category: [deps.surveyCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.CARE.CONTINGENCY_PLAN),
      subject,
      encounter,
      effectiveDateTime,
      component: components,
    },
  ];
}




