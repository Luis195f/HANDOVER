import { describe, expect, it } from 'vitest';

import { buildPriorityUiModel, hasActionablePrioritySignal } from '@/src/lib/priority-ui';
import type { PrioritizedPatient } from '@/src/lib/priority';
import type { PendingTaskSummary } from '@/src/types/handover';

const basePatient: PrioritizedPatient = {
  patientId: 'pat-1',
  displayName: 'Paciente 1',
  bedLabel: 'A1',
  news2Score: 7,
  totalScore: 12,
  baseScore: 10,
  level: 'critical',
  baseLevel: 'critical',
  reasons: ['HIGH_NEWS2', 'PENDING_URGENT_TASK'],
  reasonSummary: 'NEWS2 7, 1 pendiente crítico',
  pendingCriticalTasksCount: 1,
  explanation: {
    engine: 'mpac-v1-hybrid-rules',
    version: 1,
    sourceData: ['NEWS2 7 (alto)'],
    clinicalChange: ['Incidente reciente registrado'],
    pendingCritical: ['Gasometría urgente (crítico)'],
    activeContext: {
      unitId: 'icu-a',
      specialtyId: null,
      unitProfileId: null,
      specialtyOverlayIds: [],
      activeProfileIds: [],
      labels: ['HANDOVER Core'],
      usesCoreFallback: true,
      hasHumanSpecialtyOverride: false,
    },
    coreDimensions: [],
    modifiers: [],
  },
};

describe('priority-ui', () => {
  it('builds omission and time-window copy for urgent tasks', () => {
    const tasks: PendingTaskSummary[] = [
      {
        id: 'task-1',
        title: 'Gasometría urgente',
        priority: 'routine',
        category: 'critical-task',
        dueBy: '2026-03-19T10:45:00.000Z',
      },
    ];

    const model = buildPriorityUiModel({
      patient: basePatient,
      pendingTasks: tasks,
      referenceTime: '2026-03-19T10:15:00.000Z',
    });

    expect(model.hasSignal).toBe(true);
    expect(model.whyNow).toContain('Incidente reciente');
    expect(model.actionLabel).toBe('No omitir: Gasometría urgente');
    expect(model.omissionLabel).toBe('Riesgo de omisión alto');
    expect(model.windowLabel).toBe('Ventana en 30 min');
  });

  it('does not flag a patient without contextual signals', () => {
    const quietPatient: PrioritizedPatient = {
      ...basePatient,
      patientId: 'pat-2',
      displayName: 'Paciente estable',
      news2Score: 0,
      totalScore: 0,
      baseScore: 0,
      level: 'low',
      baseLevel: 'low',
      reasons: [],
      reasonSummary: 'Sin señal contextual relevante',
      pendingCriticalTasksCount: 0,
      explanation: {
        ...basePatient.explanation,
        sourceData: [],
        clinicalChange: [],
        pendingCritical: [],
      },
    };

    expect(hasActionablePrioritySignal(quietPatient)).toBe(false);
  });

  it('surfaces contextual overlay guidance in the existing brief priority UI when oncology modifiers are active', () => {
    const contextualPatient: PrioritizedPatient = {
      ...basePatient,
      patientId: 'pat-onc',
      displayName: 'Paciente Onco',
      news2Score: 4,
      totalScore: 6.2,
      baseScore: 4.5,
      level: 'high',
      baseLevel: 'medium',
      reasons: ['PROFILE_CONTEXT'],
      reasonSummary: 'NEWS2 4, contexto Consulta externa y ambulatoria + Oncologia y hematologia',
      pendingCriticalTasksCount: 0,
      explanation: {
        ...basePatient.explanation,
        sourceData: [],
        clinicalChange: [],
        pendingCritical: [],
        activeContext: {
          unitId: 'onc-ward',
          specialtyId: 'onc',
          unitProfileId: 'ambulatory',
          specialtyOverlayIds: ['onc'],
          activeProfileIds: ['handover-core', 'ambulatory', 'onc'],
          labels: ['HANDOVER Core', 'Consulta externa y ambulatoria', 'Oncologia y hematologia'],
          usesCoreFallback: false,
          hasHumanSpecialtyOverride: false,
        },
        modifiers: [
          {
            signalId: 'overlay-onc-neutropenia',
            label: 'Neutropenia febril y sepsis oculta',
            dimension: 'deterioration-risk',
            source: 'specialty-overlay',
            profileId: 'onc',
            weight: 1.35,
            contribution: 1,
            applied: true,
            note: 'SOP: EOPROP-IA prioriza fiebre, inmunosupresion y deterioro infeccioso precoz.',
          },
        ],
      },
    };

    const model = buildPriorityUiModel({
      patient: contextualPatient,
      referenceTime: '2026-03-19T10:15:00.000Z',
    });

    expect(model.whyNow).toBe('Contexto activo: Neutropenia febril y sepsis oculta');
    expect(model.actionLabel).toBe('No omitir: Neutropenia febril y sepsis oculta');
    expect(model.windowLabel).toBe('Ventana: reevaluar este turno');
    expect(model.windowTone).toBe('warning');
  });

  it('prioritizes oncology modifiers explicitly instead of trusting source order', () => {
    const contextualPatient: PrioritizedPatient = {
      ...basePatient,
      patientId: 'pat-onc-ranked',
      displayName: 'Paciente Onco 2',
      reasons: ['PROFILE_CONTEXT'],
      pendingCriticalTasksCount: 0,
      explanation: {
        ...basePatient.explanation,
        sourceData: [],
        clinicalChange: [],
        pendingCritical: [],
        activeContext: {
          unitId: 'onc-ward',
          specialtyId: 'onc',
          unitProfileId: 'ambulatory',
          specialtyOverlayIds: ['onc'],
          activeProfileIds: ['handover-core', 'ambulatory', 'onc'],
          labels: ['HANDOVER Core', 'Consulta externa y ambulatoria', 'Oncologia y hematologia'],
          usesCoreFallback: false,
          hasHumanSpecialtyOverride: false,
        },
        modifiers: [
          {
            signalId: 'overlay-onc-palliation',
            label: 'Necesidades paliativas y alivio de síntomas',
            dimension: 'coordination',
            source: 'specialty-overlay',
            profileId: 'onc',
            weight: 1,
            contribution: 1.5,
            applied: true,
            note: 'SOP: soporte paliativo.',
          },
          {
            signalId: 'overlay-onc-neutropenia',
            label: 'Neutropenia febril y sepsis oculta',
            dimension: 'deterioration-risk',
            source: 'specialty-overlay',
            profileId: 'onc',
            weight: 1,
            contribution: 0.4,
            applied: true,
            note: 'SOP: fiebre e inmunosupresión temprana.',
          },
        ],
      },
    };

    const model = buildPriorityUiModel({
      patient: contextualPatient,
      referenceTime: '2026-03-19T10:15:00.000Z',
    });

    expect(model.whyNow).toBe('Contexto activo: Neutropenia febril y sepsis oculta');
    expect(model.actionLabel).toBe('No omitir: Neutropenia febril y sepsis oculta');
  });
});
