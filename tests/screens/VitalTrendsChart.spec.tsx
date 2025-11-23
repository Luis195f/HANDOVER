// BEGIN HANDOVER D2 – VitalTrends tests
import React from 'react';
import { render } from '@testing-library/react-native';

import { VitalTrendsChart } from '@/src/screens/components/VitalTrendsChart';
import type { VitalTrendsData } from '../../types/vitals';

const mockTrends: VitalTrendsData = {
  hr: [
    { time: '2024-01-01T00:00:00Z', value: 80 },
    { time: '2024-01-01T01:00:00Z', value: 82 },
    { time: '2024-01-01T02:00:00Z', value: 85 },
  ],
  sbp: [
    { time: '2024-01-01T00:00:00Z', value: 118 },
    { time: '2024-01-01T02:00:00Z', value: 121 },
  ],
  rr: [
    { time: '2024-01-01T00:00:00Z', value: 18 },
    { time: '2024-01-01T02:00:00Z', value: 19 },
  ],
  spo2: [
    { time: '2024-01-01T00:00:00Z', value: 96 },
    { time: '2024-01-01T01:00:00Z', value: 97 },
  ],
  temp: [
    { time: '2024-01-01T00:00:00Z', value: 37.1 },
    { time: '2024-01-01T02:00:00Z', value: 37.3 },
  ],
};

describe('VitalTrendsChart', () => {
  it('renderiza el número correcto de series', () => {
    const { getByText, getByTestId } = render(<VitalTrendsChart trends={mockTrends} />);

    expect(getByText('Frecuencia cardíaca (lpm)')).toBeTruthy();
    expect(getByText('PA sistólica (mmHg)')).toBeTruthy();
    expect(getByText('FR (rpm)')).toBeTruthy();
    expect(getByText('SpO₂ (%)')).toBeTruthy();
    expect(getByText('Temperatura (°C)')).toBeTruthy();

    expect(getByTestId('vital-series-hr')).toBeTruthy();
    expect(getByTestId('vital-series-sbp')).toBeTruthy();
    expect(getByTestId('vital-series-rr')).toBeTruthy();
    expect(getByTestId('vital-series-spo2')).toBeTruthy();
    expect(getByTestId('vital-series-temp')).toBeTruthy();
  });

  it('no renderiza nada cuando trends es null', () => {
    const { toJSON } = render(<VitalTrendsChart trends={null} />);

    expect(toJSON()).toBeNull();
  });

  it('coincide con el snapshot de estructura básica', () => {
    const { toJSON } = render(<VitalTrendsChart trends={mockTrends} />);

    expect(toJSON()).toMatchSnapshot();
  });
});
// END HANDOVER D2 – VitalTrends tests
