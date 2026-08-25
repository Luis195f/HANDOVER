import { Alert, Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { confirmAction } from '@/src/lib/platform-confirm';

const options = {
  title: 'Confirm action',
  message: 'Proceed safely?',
  confirmText: 'Accept',
  cancelText: 'Cancel',
};

describe('confirmAction', () => {
  const originalPlatform = Platform.OS;
  const originalConfirm = globalThis.confirm;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: originalConfirm });
    vi.restoreAllMocks();
  });

  it('returns true when the web confirmation is accepted', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    const webConfirm = vi.fn(() => true);
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: webConfirm });

    await expect(confirmAction(options)).resolves.toBe(true);
    expect(webConfirm).toHaveBeenCalledWith('Confirm action\n\nProceed safely?');
  });

  it('returns false when the web confirmation is cancelled', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    Object.defineProperty(globalThis, 'confirm', { configurable: true, value: vi.fn(() => false) });

    await expect(confirmAction(options)).resolves.toBe(false);
  });

  it('preserves Alert.alert callbacks on native platforms', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Accept')?.onPress?.();
    });

    await expect(confirmAction(options)).resolves.toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      'Confirm action',
      'Proceed safely?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Accept', style: 'default' }),
      ]),
      expect.objectContaining({ cancelable: true }),
    );
  });
});
