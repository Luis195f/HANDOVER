import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmAction } from '@/src/lib/platform-confirm';
import { hasPrivacyConsent, setPrivacyConsent } from '@/src/lib/privacy-consent';
import { setOnboardingCompleted } from '@/src/lib/onboarding-storage';
import OnboardingScreen from '@/src/screens/OnboardingScreen';

vi.mock('@/src/lib/platform-confirm', () => ({ confirmAction: vi.fn() }));
vi.mock('@/src/lib/privacy-consent', () => ({
  hasPrivacyConsent: vi.fn(),
  setPrivacyConsent: vi.fn(),
}));
vi.mock('@/src/lib/onboarding-storage', () => ({ setOnboardingCompleted: vi.fn() }));

const navigation = {
  navigate: vi.fn(),
  reset: vi.fn(),
};
const route = { key: 'onboarding', name: 'Onboarding' } as const;

describe('OnboardingScreen web confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes after accepted consent and accepted skip confirmation', async () => {
    vi.mocked(hasPrivacyConsent).mockResolvedValue(true);
    vi.mocked(confirmAction).mockResolvedValue(true);
    const ui = render(<OnboardingScreen navigation={navigation as never} route={route as never} />);

    fireEvent(ui.getByLabelText('Consentimiento de privacidad'), 'valueChange', true);
    fireEvent.press(ui.getByText('Saltar'));

    await waitFor(() => expect(setOnboardingCompleted).toHaveBeenCalledWith(true));
    expect(setPrivacyConsent).toHaveBeenCalledWith(true);
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'PatientList' }] });
  });

  it('remains in onboarding when skip confirmation is cancelled', async () => {
    vi.mocked(hasPrivacyConsent).mockResolvedValue(true);
    vi.mocked(confirmAction).mockResolvedValue(false);
    const ui = render(<OnboardingScreen navigation={navigation as never} route={route as never} />);

    fireEvent(ui.getByLabelText('Consentimiento de privacidad'), 'valueChange', true);
    fireEvent.press(ui.getByText('Saltar'));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledOnce());
    expect(setOnboardingCompleted).not.toHaveBeenCalled();
    expect(navigation.reset).not.toHaveBeenCalled();
  });

  it('never requests skip confirmation or completes without consent', async () => {
    vi.mocked(hasPrivacyConsent).mockResolvedValue(false);
    const ui = render(<OnboardingScreen navigation={navigation as never} route={route as never} />);

    fireEvent.press(ui.getByText('Saltar'));

    await waitFor(() => expect(hasPrivacyConsent).toHaveBeenCalledOnce());
    expect(confirmAction).not.toHaveBeenCalled();
    expect(setOnboardingCompleted).not.toHaveBeenCalled();
  });

  it('hides QR only for the active synthetic demo session', () => {
    vi.mocked(hasPrivacyConsent).mockResolvedValue(true);
    const ui = render(
      <OnboardingScreen navigation={navigation as never} route={route as never} syntheticDemo />,
    );

    fireEvent.press(ui.getByText('Siguiente'));
    fireEvent.press(ui.getByText('Siguiente'));
    fireEvent.press(ui.getByText('Siguiente'));

    expect(ui.queryByText('Escaneo de QR del paciente')).toBeNull();
    expect(ui.getByText('Centro de sincronización')).toBeTruthy();
  });
});
