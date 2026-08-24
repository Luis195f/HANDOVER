import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_ACTORS } from '@/src/demo/fixtures';
import { SignaturesSection } from '@/src/screens/components/SignaturesSection';
import type { HandoverValues } from '@/src/validation/schemas';

vi.mock('@/src/i18n', () => ({
  t: (key: string) => key,
}));

describe('SignaturesSection demo actors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures outgoing A and incoming B through the existing session attestation flow', () => {
    vi.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'signatures.confirm')?.onPress?.();
    });
    const onChange = vi.fn();
    const [outgoingActor, incomingActor] = DEMO_ACTORS;
    const ui = render(
      <SignaturesSection
        currentUser={outgoingActor}
        administrativeUnitId={outgoingActor.units[0]}
        onChange={onChange}
      />,
    );

    fireEvent.press(ui.getByText('signatures.signOutgoing'));
    const outgoingValue = onChange.mock.calls[0]?.[0] as HandoverValues['signatures'];
    expect(outgoingValue?.outgoing).toMatchObject({
      userId: outgoingActor.userId,
      role: 'nurse',
      method: 'session',
    });

    act(() => {
      ui.update(
        <SignaturesSection
          value={outgoingValue}
          currentUser={incomingActor}
          administrativeUnitId={incomingActor.units[0]}
          onChange={onChange}
        />,
      );
    });
    fireEvent.press(ui.getByText('signatures.signIncoming'));

    const completedValue = onChange.mock.calls[1]?.[0] as HandoverValues['signatures'];
    expect(completedValue?.outgoing?.userId).toBe(outgoingActor.userId);
    expect(completedValue?.incoming).toMatchObject({
      userId: incomingActor.userId,
      role: 'nurse',
      method: 'session',
    });
  });

  it('uses the same incoming attestation mutation from the demo E2E confirmation', () => {
    const onChange = vi.fn();
    const [outgoingActor, incomingActor] = DEMO_ACTORS;
    const outgoing = {
      userId: outgoingActor.userId,
      fullName: outgoingActor.displayName,
      role: 'nurse' as const,
      unitId: outgoingActor.units[0],
      signedAt: '2026-08-24T10:00:00.000Z',
      method: 'session' as const,
    };
    const ui = render(
      <SignaturesSection
        value={{ outgoing }}
        currentUser={incomingActor}
        administrativeUnitId={incomingActor.units[0]}
        onChange={onChange}
        allowE2EIncomingConfirmation
      />,
    );

    fireEvent.press(ui.getByTestId('e2e-confirm-incoming-attestation'));

    const completedValue = onChange.mock.calls[0]?.[0] as HandoverValues['signatures'];
    expect(completedValue?.outgoing?.userId).toBe(outgoingActor.userId);
    expect(completedValue?.incoming).toMatchObject({
      userId: incomingActor.userId,
      role: 'nurse',
      method: 'session',
    });
  });
});
