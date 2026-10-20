import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS, DEMO_NOW } from '@/src/demo/fixtures';
import { buildExceptionHandoverContextKey, classifyExceptionHandoverPatient, createExceptionReviewEvent, createHandoffOverride, formatExceptionDateTime } from '@/src/lib/exception-handover';
import { createEmptyExceptionHandoverState } from '@/src/lib/exception-handover-storage';
import { UnitExceptionHandover } from '../UnitExceptionHandover';

const colors = {
  background: '#FFFFFF',
  border: '#CBD5E1',
  danger: '#B91C1C',
  info: '#0369A1',
  muted: '#475569',
  primary: '#0F766E',
  success: '#15803D',
  surface: '#F8FAFC',
  text: '#0F172A',
  warning: '#B45309',
};

const now = () => '2026-08-27T08:15:00.000Z';
const groupScope = { viewScope: 'all-units', members: DEMO_EXCEPTION_HANDOVER_PATIENTS.map((patient) => ({
  patientId: patient.patientId, unitId: 'demo-unit',
})) };

describe('UnitExceptionHandover', () => {
  it('blocks closure and autosave after persisted evidence fails to hydrate', async () => {
    const save = vi.fn(async () => {});
    const storage = { load: vi.fn(async () => { throw new Error('synthetic corruption'); }), save, clear: vi.fn(async () => {}) };
    const screen = render(<UnitExceptionHandover patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
      groupScope={groupScope} sessionUserId={DEMO_ACTORS[0].userId} colors={colors}
      onOpenFullHandover={() => {}} now={now} storage={storage} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Evidencia local no legible o no persistida; cierre bloqueado.')).toBeTruthy();
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
  it('separates the synthetic classification clock from the interaction clock', () => {
    const interactionNow = '2026-09-14T19:45:00.000Z';
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        classificationReferenceTime={DEMO_NOW}
        now={() => interactionNow}
        storage={null}
      />,
    );

    expect(screen.getByText('2 prioridad alta')).toBeTruthy();
    expect(screen.getByText('6 con novedades')).toBeTruthy();
    expect(screen.getByText('32 sin novedades')).toBeTruthy();
    expect(screen.getByText('0 revisión requerida')).toBeTruthy();

    fireEvent.press(screen.getByTestId('confirm-unchanged-review'));

    const provenance = screen.getByTestId('unchanged-review-event').props.children.join('');
    expect(provenance).toContain(formatExceptionDateTime(interactionNow));
    expect(provenance).not.toContain(formatExceptionDateTime(DEMO_NOW));
  });

  it('reviews unchanged collectively within two interactions and leaves individual cards closed', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
      />,
    );

    expect(screen.getByText('C. SIN NOVEDADES CONFIRMADAS · 32')).toBeTruthy();
    expect(screen.queryByTestId('exception-patient-demo-psych-adult-002')).toBeNull();

    fireEvent.press(screen.getByTestId('expand-unchanged-list'));
    expect(screen.getByTestId('exception-patient-demo-psych-adult-002')).toBeTruthy();
    fireEvent.press(screen.getByTestId('confirm-unchanged-review'));

    expect(screen.getByTestId('unchanged-interaction-count').props.children.join('')).toContain('2');
    expect(screen.getByTestId('unchanged-review-event').props.children.join('')).toContain('Profesional saliente demo');
  });

  it('accepts a changed brief without opening the full form and keeps full detail available', () => {
    const openFull = vi.fn();
    const changed = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((patient) => patient.status === 'changed')!;
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={openFull}
        now={now}
        storage={null}
      />,
    );

    fireEvent.press(screen.getByTestId(`open-exception-${changed.patientId}`));
    fireEvent.press(screen.getByTestId(`accept-brief-${changed.patientId}`));

    expect(openFull).not.toHaveBeenCalled();
    expect(screen.getByTestId(`quick-interactions-${changed.patientId}`).props.children.join('')).toContain('2');
    expect(screen.getByText('Relevo breve revisado')).toBeTruthy();
    expect(screen.getByTestId(`exception-sbar-${changed.patientId}`)).toBeTruthy();
    expect(screen.getByText('Borrador determinista')).toBeTruthy();

    fireEvent.press(screen.getByText('Ver detalle completo'));
    expect(openFull).toHaveBeenCalledWith(changed.patientId);
  });

  it('generates priority SBAR on open and requires incoming check-back with actor and timestamp', () => {
    const critical = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((patient) => patient.status === 'critical')!;
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
      />,
    );

    fireEvent.press(screen.getByTestId(`open-exception-${critical.patientId}`));
    expect(screen.getByTestId(`exception-sbar-${critical.patientId}`)).toBeTruthy();
    expect(screen.getByTestId(`confirm-checkback-${critical.patientId}`).props.disabled).toBe(true);

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
          groupScope={groupScope}
          sessionUserId={DEMO_ACTORS[1].userId}
          colors={colors}
          onOpenFullHandover={() => {}}
          now={now}
          storage={null}
        />,
      );
    });

    for (const item of critical.criticalItems) {
      fireEvent(screen.getByRole('switch', { name: item }), 'valueChange', true);
    }
    fireEvent.press(screen.getByTestId(`confirm-checkback-${critical.patientId}`));

    const provenance = screen.getByTestId(`exception-event-critical_check_back-${critical.patientId}`).props.children.join('');
    expect(provenance).toContain('Check-back de profesional entrante');
    expect(provenance).toContain('Profesional receptora demo');
    expect(provenance).toContain('Puntos: Nivel de observación y medidas de entorno seguro.');
    expect(screen.getByTestId(`quick-interactions-${critical.patientId}`).props.children.join('')).toContain('5');
    expect(screen.getByTestId(`transfer-status-${critical.patientId}`).props.children.join('')).toContain('completed');
  });

  it('blocks unit closure until all A are acknowledged or escalated and keeps actor events separate', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
      />,
    );

    const blockedOutgoing = screen.getByTestId('confirm-outgoing-transfer');
    expect(blockedOutgoing.props.disabled).toBe(true);
    expect(screen.queryByTestId('outgoing-transfer-event')).toBeNull();
    expect(String(screen.getByTestId('exception-closure-blocked').props.children)).toContain('prioridades A');

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
          groupScope={groupScope}
          sessionUserId={DEMO_ACTORS[1].userId}
          colors={colors}
          onOpenFullHandover={() => {}}
          now={now}
          storage={null}
        />,
      );
    });

    const criticalPatients = DEMO_EXCEPTION_HANDOVER_PATIENTS.filter((patient) => patient.status === 'critical');
    for (const patient of criticalPatients) {
      fireEvent.press(screen.getByTestId(`open-exception-${patient.patientId}`));
      fireEvent.press(screen.getByText('Registrar escalado'));
      fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    }
    expect(String(screen.getByTestId('exception-closure-blocked').props.children)).toContain('pacientes B');
    for (const patient of DEMO_EXCEPTION_HANDOVER_PATIENTS.filter((candidate) => candidate.status === 'changed')) {
      fireEvent.press(screen.getByTestId(`open-exception-${patient.patientId}`));
      fireEvent.press(screen.getByTestId(`accept-brief-${patient.patientId}`));
      fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    }
    expect(String(screen.getByTestId('exception-closure-blocked').props.children)).toContain('grupo C');
    fireEvent.press(screen.getByTestId('confirm-unchanged-review'));

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
          groupScope={groupScope}
          sessionUserId={DEMO_ACTORS[0].userId}
          colors={colors}
          onOpenFullHandover={() => {}}
          now={now}
          storage={null}
        />,
      );
    });
    fireEvent.press(screen.getByText('Confirmar transferencia saliente'));
    expect(screen.getByTestId('outgoing-transfer-event').props.children.join('')).toContain('Profesional saliente demo');

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
          groupScope={groupScope}
          sessionUserId={DEMO_ACTORS[1].userId}
          colors={colors}
          onOpenFullHandover={() => {}}
          now={now}
          storage={null}
        />,
      );
    });
    fireEvent.press(screen.getByText('Atestar recepción entrante'));

    expect(screen.getByTestId('incoming-attestation-event').props.children.join('')).toContain('Profesional receptora demo');
  });

  it('requires fresh collective evidence after scope and census changes, but not reordering', () => {
    const unchanged = DEMO_EXCEPTION_HANDOVER_PATIENTS.filter((patient) => patient.status === 'unchanged').slice(0, 2);
    const scope = (viewScope: string, patients: typeof unchanged) => ({ viewScope,
      members: patients.map((patient) => ({ patientId: patient.patientId, unitId: 'unit-a' })) });
    const board = (patients: typeof unchanged, viewScope: string, userId: string) => (
      <UnitExceptionHandover patients={patients} groupScope={scope(viewScope, patients)}
        sessionUserId={userId} colors={colors} onOpenFullHandover={() => {}} now={now} storage={null} />
    );
    const screen = render(board(unchanged, 'unit-a', DEMO_ACTORS[0].userId));
    fireEvent.press(screen.getByTestId('confirm-unchanged-review'));
    act(() => screen.update(board([...unchanged].reverse(), 'unit-a', DEMO_ACTORS[0].userId)));
    expect(screen.queryByTestId('exception-closure-blocked')).toBeNull();
    fireEvent.press(screen.getByTestId('confirm-outgoing-transfer'));
    act(() => screen.update(board(unchanged, 'unit-a', DEMO_ACTORS[1].userId)));
    fireEvent.press(screen.getByTestId('confirm-incoming-attestation'));
    expect(screen.getByTestId('incoming-attestation-event')).toBeTruthy();

    act(() => screen.update(board(unchanged.slice(0, 1), 'unit-a', DEMO_ACTORS[0].userId)));
    expect(screen.queryByTestId('outgoing-transfer-event')).toBeNull();
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('confirm-unchanged-review'));
    expect(screen.queryByTestId('exception-closure-blocked')).toBeNull();
    act(() => screen.update(board(unchanged, 'unit-a', DEMO_ACTORS[0].userId)));
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(true);
    expect(screen.queryByTestId('incoming-attestation-event')).toBeNull();
    act(() => screen.update(board(unchanged, 'all-units', DEMO_ACTORS[0].userId)));
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(true);
  });

  it('does not restore a legacy or stale closure after hydration changes context', async () => {
    const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.status === 'unchanged')!;
    const first = [patient];
    const second = DEMO_EXCEPTION_HANDOVER_PATIENTS.filter((candidate) => candidate.status === 'unchanged').slice(0, 2);
    const scope = (patients: typeof first) => ({ viewScope: 'unit-a',
      members: patients.map((candidate) => ({ patientId: candidate.patientId, unitId: 'unit-a' })) });
    const key = buildExceptionHandoverContextKey(patient.shiftId!, 'unit-a', scope(first).members,
      [classifyExceptionHandoverPatient(patient, { now: now(), shiftId: patient.shiftId })]);
    const staleContext = { key, revision: 1, shiftId: patient.shiftId! };
    let resolveLoad!: (value: ReturnType<typeof createEmptyExceptionHandoverState>) => void;
    const storage = { load: vi.fn(() => new Promise<ReturnType<typeof createEmptyExceptionHandoverState>>((resolve) => {
      resolveLoad = resolve;
    })), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
    const board = (patients: typeof first) => <UnitExceptionHandover patients={patients} groupScope={scope(patients)}
      sessionUserId={DEMO_ACTORS[0].userId} colors={colors} onOpenFullHandover={() => {}} now={now} storage={storage} />;
    const screen = render(board(first));
    act(() => screen.update(board(second)));
    act(() => screen.update(board(first)));
    await act(async () => resolveLoad({ ...createEmptyExceptionHandoverState(patient.shiftId!),
      activeContext: staleContext,
      events: [createExceptionReviewEvent('unchanged_group_review', DEMO_ACTORS[0], now(), undefined,
        { shiftId: patient.shiftId, context: staleContext }),
      createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], now(), undefined, { shiftId: patient.shiftId })],
    }));
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(true);
    expect(screen.queryByTestId('unchanged-review-event')).toBeNull();
    expect(screen.getByText(/eventos anteriores sin contexto de grupo/)).toBeTruthy();
  });

  it('requires the incoming attestation to acknowledge the current outgoing transfer', async () => {
    const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.status === 'unchanged')!;
    const patients = [patient];
    const scoped = { viewScope: 'unit-a', members: [{ patientId: patient.patientId, unitId: 'unit-a' }] };
    const shiftId = patient.shiftId!;
    const key = buildExceptionHandoverContextKey(shiftId, scoped.viewScope, scoped.members,
      [classifyExceptionHandoverPatient(patient, { now: now(), shiftId })]);
    const context = { key, revision: 1, shiftId };
    const collective = createExceptionReviewEvent('unchanged_group_review', DEMO_ACTORS[0], now(), undefined, { shiftId, context });
    const outgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], now(), undefined, { shiftId, context });
    const wrongIncoming = createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], now(), undefined,
      { shiftId, context, acknowledgesKey: 'other-transfer' });
    const state = { ...createEmptyExceptionHandoverState(shiftId), activeContext: context,
      events: [collective, outgoing, wrongIncoming] };
    let saved = state;
    const storage = { load: vi.fn(async () => state), save: vi.fn(async (next: typeof state) => { saved = next; }),
      clear: vi.fn(async () => {}) };
    const screen = render(<UnitExceptionHandover patients={patients} groupScope={scoped}
      sessionUserId={DEMO_ACTORS[1].userId} colors={colors} onOpenFullHandover={() => {}} now={now} storage={storage} />);
    await act(async () => {});
    expect(screen.getByTestId('outgoing-transfer-event')).toBeTruthy();
    expect(screen.queryByTestId('incoming-attestation-event')).toBeNull();
    fireEvent.press(screen.getByTestId('confirm-incoming-attestation'));
    expect(screen.getByTestId('incoming-attestation-event')).toBeTruthy();
    expect(saved.events).toHaveLength(4);
    expect(saved.events.at(-1)?.acknowledgesKey).toBe(outgoing.idempotencyKey);
  });

  it('resumes matching reviewed evidence after loading a persisted classification override', async () => {
    const source = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((patient) => patient.status === 'unchanged')!;
    const patient = { ...source, sourceEvidence: { ...source.sourceEvidence,
      'direct-assessment': { status: 'missing' as const } } };
    const shiftId = patient.shiftId!;
    const override = createHandoffOverride({ patientId: patient.patientId, previousLane: 'R', newLane: 'B',
      reason: 'Valoración manual completada', professional: DEMO_ACTORS[0], shiftId,
      recordedAt: now(), sourceStatuses: { 'direct-assessment': 'missing' } });
    const scoped = { viewScope: 'unit-a', members: [{ patientId: patient.patientId, unitId: 'unit-a' }] };
    const classified = classifyExceptionHandoverPatient({ ...patient, previousOverrides: [override] }, { now: now(), shiftId });
    const context = { key: buildExceptionHandoverContextKey(shiftId, scoped.viewScope, scoped.members, [classified]),
      revision: 1, shiftId };
    const state = { ...createEmptyExceptionHandoverState(shiftId), overrides: [override], activeContext: context,
      events: [createExceptionReviewEvent('brief_review', DEMO_ACTORS[0], now(), patient.patientId, { shiftId, context }),
        createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], now(), undefined, { shiftId, context })] };
    const storage = { load: vi.fn(async () => state), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
    const screen = render(<UnitExceptionHandover patients={[patient]} groupScope={scoped}
      sessionUserId={DEMO_ACTORS[0].userId} colors={colors} onOpenFullHandover={() => {}}
      now={now} storage={storage} />);
    await act(async () => {});
    expect(screen.getByTestId('outgoing-transfer-event')).toBeTruthy();
    expect(screen.queryByTestId('exception-closure-blocked')).toBeNull();
  });

  it('resumes a new shift after an earlier group change without carrying its hydration flag', async () => {
    const source = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((patient) => patient.status === 'unchanged')!;
    const patient = { ...source, sourceEvidence: { ...source.sourceEvidence,
      'direct-assessment': { status: 'missing' as const } } };
    const nextShift = 'demo-next-shift';
    const override = createHandoffOverride({ patientId: patient.patientId, previousLane: 'R', newLane: 'B',
      reason: 'Valoración manual completada', professional: DEMO_ACTORS[0], shiftId: nextShift,
      recordedAt: now(), sourceStatuses: { 'direct-assessment': 'missing' } });
    const scope = (viewScope: string) => ({ viewScope,
      members: [{ patientId: patient.patientId, unitId: 'unit-a' }] });
    const classified = classifyExceptionHandoverPatient({ ...patient, previousOverrides: [override] },
      { now: now(), shiftId: nextShift });
    const context = { key: buildExceptionHandoverContextKey(nextShift, 'unit-a', scope('unit-a').members, [classified]),
      revision: 1, shiftId: nextShift };
    const loaded = { ...createEmptyExceptionHandoverState(nextShift), overrides: [override], activeContext: context,
      events: [createExceptionReviewEvent('brief_review', DEMO_ACTORS[0], now(), patient.patientId,
        { shiftId: nextShift, context }),
      createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], now(), undefined,
        { shiftId: nextShift, context })] };
    const storage = { load: vi.fn(async (shiftId: string) => shiftId === nextShift
      ? loaded : createEmptyExceptionHandoverState(shiftId)), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
    const board = (shiftId: string, viewScope: string) => <UnitExceptionHandover patients={[patient]}
      shiftId={shiftId} groupScope={scope(viewScope)} sessionUserId={DEMO_ACTORS[0].userId}
      colors={colors} onOpenFullHandover={() => {}} now={now} storage={storage} />;
    const screen = render(board('demo-first-shift', 'unit-a'));
    await act(async () => {});
    act(() => screen.update(board('demo-first-shift', 'all-units')));
    act(() => screen.update(board(nextShift, 'unit-a')));
    await act(async () => {});
    expect(screen.getByTestId('outgoing-transfer-event')).toBeTruthy();
    expect(screen.queryByTestId('exception-closure-blocked')).toBeNull();
  });

  it('invalidates a reviewed B brief and transfer when its clinical draft is edited', () => {
    const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.status === 'changed')!;
    const scoped = { viewScope: 'unit-a', members: [{ patientId: patient.patientId, unitId: 'unit-a' }] };
    const screen = render(<UnitExceptionHandover patients={[patient]} groupScope={scoped}
      sessionUserId={DEMO_ACTORS[0].userId} colors={colors} onOpenFullHandover={() => {}}
      now={now} storage={null} />);
    fireEvent.press(screen.getByTestId(`open-exception-${patient.patientId}`));
    fireEvent.press(screen.getByTestId(`accept-brief-${patient.patientId}`));
    fireEvent.press(screen.getByTestId('confirm-outgoing-transfer'));
    expect(screen.getByTestId('outgoing-transfer-event')).toBeTruthy();
    const riskInput = screen.root.find((node) => node.props.value === patient.currentRisk &&
      typeof node.props.onChangeText === 'function');
    fireEvent.changeText(riskInput, 'Riesgo actualizado durante el relevo');
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(true);
    expect(screen.queryByTestId('outgoing-transfer-event')).toBeNull();
    fireEvent.press(screen.getByTestId(`accept-brief-${patient.patientId}`));
    expect(screen.getByTestId('confirm-outgoing-transfer').props.disabled).toBe(false);
  });

  it('shows one partial-degradation banner and moves only dependent baseline-C patients to R', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
        integrationState={{
          availability: 'partial',
          sourceStatuses: { 'observation-record': 'unavailable' },
          failureStartedAt: '2026-08-27T08:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByTestId('unit-data-health-banner')).toBeTruthy();
    expect(screen.getByText('R. REVISIÓN REQUERIDA · 7')).toBeTruthy();
    expect(screen.getByText('C. SIN NOVEDADES CONFIRMADAS · 25')).toBeTruthy();
    expect(screen.getByText('A. PRIORIDAD INMEDIATA · 2')).toBeTruthy();
    expect(screen.getByText('B. CON NOVEDADES · 6')).toBeTruthy();

    fireEvent.press(screen.getByTestId('open-exception-demo-psych-unit-010'));
    expect(screen.getByTestId('r-information-demo-psych-unit-010')).toBeTruthy();
    expect(screen.queryByTestId('exception-sbar-demo-psych-unit-010')).toBeNull();
    expect(screen.getByText('Registro de observación no verificable')).toBeTruthy();
  });

  it('keeps recovery degraded until it is explicitly confirmed and stable', () => {
    const renderBoard = (integrationState: React.ComponentProps<typeof UnitExceptionHandover>['integrationState']) => (
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
        integrationState={integrationState}
      />
    );
    const screen = render(renderBoard({
      availability: 'partial',
      sourceStatuses: { 'observation-record': 'unavailable' },
      failureStartedAt: '2026-08-27T08:00:00.000Z',
    }));

    act(() => screen.update(renderBoard({ availability: 'available' })));
    expect(screen.getByText('Recuperación pendiente de confirmación estable')).toBeTruthy();

    act(() => screen.update(renderBoard({
      availability: 'available',
      recoveryConfirmedAt: '2026-08-27T08:14:00.000Z',
      stableSince: '2026-08-27T07:55:00.000Z',
    })));
    expect(screen.queryByTestId('unit-data-health-banner')).toBeNull();
  });

  it('supports a reasoned R override without persisting it as the next-shift rule', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        groupScope={groupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
        integrationState={{
          availability: 'partial',
          sourceStatuses: { 'observation-record': 'unavailable' },
          failureStartedAt: '2026-08-27T08:00:00.000Z',
        }}
      />,
    );

    fireEvent.press(screen.getByTestId('open-exception-demo-psych-unit-010'));
    expect(screen.getByTestId('resolve-r-demo-psych-unit-010').props.accessibilityState?.disabled ?? screen.getByTestId('resolve-r-demo-psych-unit-010').props.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('override-reason-demo-psych-unit-010'), 'Valoración manual directa realizada');
    fireEvent.press(screen.getByTestId('resolve-r-demo-psych-unit-010'));

    expect(screen.getByText('R. REVISIÓN REQUERIDA · 6')).toBeTruthy();
    expect(screen.getByText('B. CON NOVEDADES · 7')).toBeTruthy();
  });

  it('uses one degraded unit flow for 80 patients and never renders 80 R cards', () => {
    const eightyPatients = Array.from({ length: 80 }, (_, index) => ({
      ...DEMO_EXCEPTION_HANDOVER_PATIENTS[3],
      patientId: `synthetic-${index + 1}`,
      name: `Caso sintético ${index + 1}`,
      bedLabel: `SM-${index + 1}`,
    }));
    const eightyGroupScope = { viewScope: 'demo-unit', members: eightyPatients.map((patient) => ({
      patientId: patient.patientId, unitId: 'demo-unit',
    })) };
    const screen = render(
      <UnitExceptionHandover
        patients={eightyPatients}
        groupScope={eightyGroupScope}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
        storage={null}
      />,
    );

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={eightyPatients}
          groupScope={eightyGroupScope}
          sessionUserId={DEMO_ACTORS[0].userId}
          colors={colors}
          onOpenFullHandover={() => {}}
          now={now}
          storage={null}
          integrationState={{ availability: 'unavailable', failureStartedAt: now() }}
        />,
      );
    });

    expect(screen.getByTestId('unit-data-health-banner')).toBeTruthy();
    expect(screen.getByText('Clasificación automática suspendida: fuente clínica no disponible')).toBeTruthy();
    expect(screen.getByText(/Última clasificación conocida · no vigente/)).toBeTruthy();
    expect(screen.queryByTestId('r-patient-group')).toBeNull();
    expect(screen.queryByTestId('confirm-unchanged-review')).toBeNull();
    expect(screen.queryByTestId('exception-patient-synthetic-1')).toBeNull();
    expect(screen.queryByTestId('exception-patient-synthetic-80')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Responsable receptor'), DEMO_ACTORS[1].userId);
    fireEvent.press(screen.getByTestId('acknowledge-unit-incident'));
    fireEvent.press(screen.getByTestId('confirm-degraded-outgoing'));

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={eightyPatients}
          groupScope={eightyGroupScope}
          sessionUserId={DEMO_ACTORS[1].userId}
          colors={colors}
          onOpenFullHandover={() => {}}
          now={now}
          storage={null}
          integrationState={{ availability: 'unavailable', failureStartedAt: now() }}
        />,
      );
    });
    fireEvent.press(screen.getByTestId('confirm-degraded-incoming'));

    expect(screen.getByTestId('degraded-interaction-count').props.children.join('')).toContain('3 / 3');
    expect(screen.getByTestId('degraded-closure-status').props.children).toBe('Relevo degradado reconocido por el equipo receptor');
  });
});
