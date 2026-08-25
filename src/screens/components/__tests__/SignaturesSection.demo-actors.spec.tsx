import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_ACTORS } from '@/src/demo/fixtures';
import { confirmAction } from '@/src/lib/platform-confirm';
import { SignaturesSection } from '@/src/screens/components/SignaturesSection';
import type { HandoverValues } from '@/src/validation/schemas';

vi.mock('@/src/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('@/src/lib/platform-confirm', () => ({
  confirmAction: vi.fn(),
}));

describe('SignaturesSection demo actors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures outgoing A and incoming B through accepted confirmations', async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
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
    await act(async () => undefined);
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
    await act(async () => undefined);

    const completedValue = onChange.mock.calls[1]?.[0] as HandoverValues['signatures'];
    expect(completedValue?.outgoing?.userId).toBe(outgoingActor.userId);
    expect(completedValue?.incoming).toMatchObject({
      userId: incomingActor.userId,
      role: 'nurse',
      method: 'session',
    });
  });

  it('does not capture incoming B when the confirmation is cancelled', async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
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
      />,
    );

    fireEvent.press(ui.getByText('signatures.signIncoming'));
    await act(async () => undefined);

    expect(confirmAction).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
});
