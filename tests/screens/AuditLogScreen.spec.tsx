import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuditLogScreen from '@/src/screens/AuditLogScreen';

const mockApiGet = vi.fn();

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

vi.mock('@/src/lib/api', () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
}));

vi.mock('@/src/theme', () => ({
  useThemeTokens: () => ({
    colors: {
      background: '#ffffff',
      text: '#111111',
      muted: '#666666',
      border: '#dddddd',
      surface: '#f5f5f5',
      danger: '#b00020',
      info: '#0057b8',
    },
  }),
}));

describe('AuditLogScreen', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
  });

  it('renders patient pseudonyms and ignores legacy patientId fields', async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 1,
        type: 'patient_open',
        at: '2026-01-01T10:00:00Z',
        userId: 'clinician-1',
        patientKey: 'ptk_abc123abc123abc123abc123',
        patientId: 'pat-raw-42',
      },
    ]);

    const ui = render(<AuditLogScreen />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/audit/');
    });

    expect(ui.getByText('Registros de auditoría')).toBeTruthy();
    expect(ui.getByText('Solo seudónimos estables; nunca nombres ni IDs clínicos.')).toBeTruthy();
    expect(ui.getByText('ptk_abc123abc123abc123abc123')).toBeTruthy();
    expect(ui.queryByText('pat-raw-42')).toBeNull();
  });
});
