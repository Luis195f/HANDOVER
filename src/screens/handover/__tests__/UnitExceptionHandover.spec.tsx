import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
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

describe('UnitExceptionHandover', () => {
  it('reviews unchanged collectively within two interactions and leaves individual cards closed', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
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

    act(() => {
      screen.update(
        <UnitExceptionHandover
          patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
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

  it('shows one partial-degradation banner and moves only dependent baseline-C patients to R', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
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
    const screen = render(
      <UnitExceptionHandover
        patients={eightyPatients}
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
