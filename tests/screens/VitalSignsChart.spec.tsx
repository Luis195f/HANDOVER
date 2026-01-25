import React from 'react';
import { act, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

import VitalSignsChart from '@/src/components/VitalSignsChart';

describe('VitalSignsChart', () => {
  it('renderiza con valores mixtos sin lanzar errores', async () => {
    const timestamps = [2000, 1000, 3000];
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => timestamps.shift() ?? 4000);

    const renderResult = render(
      <VitalSignsChart vitals={{ hr: '88' as unknown as number, rr: '16' as unknown as number }} />,
    );

    expect(renderResult.getByTestId('vitals-signs-chart')).toBeTruthy();

    await act(async () => {
      renderResult.update(
        <VitalSignsChart vitals={{ hr: '999' as unknown as number, tempC: '39.8' as unknown as number }} />,
      );
    });

    await act(async () => {
      renderResult.update(
        <VitalSignsChart vitals={{ hr: 72, rr: Number.NaN, spo2: Infinity as number }} />,
      );
    });

    nowSpy.mockRestore();
  });
});
