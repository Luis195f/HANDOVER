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
      />,
    );

    expect(screen.getByText('C. SIN NOVEDADES · 32')).toBeTruthy();
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
      />,
    );

    fireEvent.press(screen.getByTestId(`open-exception-${changed.patientId}`));
    fireEvent.press(screen.getByTestId(`accept-brief-${changed.patientId}`));

    expect(openFull).not.toHaveBeenCalled();
    expect(screen.getByTestId(`quick-interactions-${changed.patientId}`).props.children.join('')).toContain('2');
    expect(screen.getByText('Relevo breve revisado')).toBeTruthy();

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
    expect(screen.getByTestId(`quick-interactions-${critical.patientId}`).props.children.join('')).toContain('5');
  });

  it('keeps outgoing transfer and incoming attestation as separate actor events', () => {
    const screen = render(
      <UnitExceptionHandover
        patients={DEMO_EXCEPTION_HANDOVER_PATIENTS}
        sessionUserId={DEMO_ACTORS[0].userId}
        colors={colors}
        onOpenFullHandover={() => {}}
        now={now}
      />,
    );

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
        />,
      );
    });
    fireEvent.press(screen.getByText('Atestar recepción entrante'));

    expect(screen.getByTestId('incoming-attestation-event').props.children.join('')).toContain('Profesional receptora demo');
  });
});
