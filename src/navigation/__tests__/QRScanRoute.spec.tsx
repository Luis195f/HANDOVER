import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { beforeEach, expect, test, vi } from 'vitest';

import QRScanRoute from '@/src/navigation/QRScanRoute';
import type { RootStackParamList } from '@/src/navigation/types';

const qrScreenSpies = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  mounted: vi.fn(),
}));

vi.mock('@/src/screens/QRScan', () => {
  qrScreenSpies.moduleLoaded();

  return {
    default: function QRScanScreenMock() {
      qrScreenSpies.mounted();
      return <Text testID="qr-scan-screen">QR scanner</Text>;
    },
  };
});

type QRScanProps = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

function createProps(params: RootStackParamList['QRScan']): QRScanProps {
  return {
    navigation: {} as QRScanProps['navigation'],
    route: { key: 'qr-scan-test', name: 'QRScan', params },
  };
}

beforeEach(() => {
  qrScreenSpies.moduleLoaded.mockClear();
  qrScreenSpies.mounted.mockClear();
  delete process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
});

test('loads and mounts the QR scanner only after the profile guard enables it', async () => {
  const ui = render(<QRScanRoute {...createProps({ specialtyId: 'behavioral-health' })} />);

  expect(ui.getByTestId('qr-scan-disabled')).toBeTruthy();
  expect(qrScreenSpies.moduleLoaded).not.toHaveBeenCalled();
  expect(qrScreenSpies.mounted).not.toHaveBeenCalled();

  await act(async () => {
    ui.update(<QRScanRoute {...createProps({ specialtyId: 'psych' })} />);
  });

  expect(ui.getByTestId('qr-scan-disabled')).toBeTruthy();
  expect(qrScreenSpies.moduleLoaded).not.toHaveBeenCalled();
  expect(qrScreenSpies.mounted).not.toHaveBeenCalled();

  await act(async () => {
    ui.update(<QRScanRoute {...createProps({ specialtyId: 'cardio' })} />);
  });

  await waitFor(() => expect(ui.getByTestId('qr-scan-screen')).toBeTruthy());
  expect(qrScreenSpies.moduleLoaded).toHaveBeenCalledTimes(1);
  expect(qrScreenSpies.mounted).toHaveBeenCalledTimes(1);
});
