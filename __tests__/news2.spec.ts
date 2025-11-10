jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock'),
}));

const vibrateMock = jest.fn();

jest.mock('react-native', () => ({
  Vibration: { vibrate: vibrateMock },
}));

import { alertIfCritical, computeNEWS2 } from '@/src/lib/news2';

describe('news2', () => {
  beforeEach(() => {
    vibrateMock.mockClear();
    const notifications = require('expo-notifications');
    notifications.scheduleNotificationAsync.mockClear();
  });

  test('returns high score for critical vitals', () => {
    const breakdown = computeNEWS2({ hr: 140, rr: 35, spo2: 86, sbp: 95, temp: 38.5 });
    expect(breakdown.total).toBeGreaterThanOrEqual(7);
    expect(breakdown.band).toBe('CRÍTICA');
  });

  test('alertIfCritical vibrates and notifies when score >= 7', async () => {
    const notifications = require('expo-notifications');

    await alertIfCritical(8);

    expect(vibrateMock).toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalled();
  });
});
