import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  return {
    ...actual,
    Controller: () => null,
  };
});

const mockUseZodForm = vi.fn();
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

describe('HandoverForm QR re-scan', () => {
  const navigation: any = {
    navigate: vi.fn(),
    getState: vi.fn(() => ({ routeNames: [] })),
  };

  beforeEach(() => {
    mockUseZodForm.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('actualiza patientId y unitId en re-scans cuando no están dirty', async () => {
    const values: Record<string, string> = { patientId: '', unitId: '' };
    const dirtiness: Record<string, boolean> = { patientId: false, unitId: false };
    const setValueSpy = vi.fn((field: string, value: string, _options: unknown) => {
      values[field] = value;
    });

    mockUseZodForm.mockReturnValue({
      control: {},
      formState: {},
      handleSubmit: (fn: any) => fn,
      getValues: (field: string) => values[field],
      getFieldState: (field: string) => ({ isDirty: dirtiness[field] }),
      setValue: (field: string, value: string, options: unknown) => {
        setValueSpy(field, value, options);
      },
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <HandoverForm
          navigation={navigation}
          route={{ key: 'test', name: 'HandoverForm', params: { patientId: 'A', unitId: 'U1' } } as any}
        />
      );
    });

    expect(setValueSpy).toHaveBeenCalledWith(
      'patientId',
      'A',
      expect.objectContaining({ shouldDirty: false, shouldValidate: true })
    );
    expect(setValueSpy).toHaveBeenCalledWith(
      'unitId',
      'U1',
      expect.objectContaining({ shouldDirty: false, shouldValidate: true })
    );

    setValueSpy.mockClear();

    await act(async () => {
      renderer!.update(
        <HandoverForm
          navigation={navigation}
          route={{ key: 'test', name: 'HandoverForm', params: { patientId: 'B', unitId: 'U2' } } as any}
        />
      );
    });

    expect(setValueSpy).toHaveBeenCalledWith(
      'patientId',
      'B',
      expect.objectContaining({ shouldDirty: false })
    );
    expect(setValueSpy).toHaveBeenCalledWith(
      'unitId',
      'U2',
      expect.objectContaining({ shouldDirty: false })
    );

    setValueSpy.mockClear();

    await act(async () => {
      renderer!.update(
        <HandoverForm
          navigation={navigation}
          route={{ key: 'test', name: 'HandoverForm', params: { patientId: 'C', unitId: 'U3' } } as any}
        />
      );
    });

    expect(setValueSpy).toHaveBeenCalledWith('patientId', 'C', expect.any(Object));
    expect(setValueSpy).toHaveBeenCalledWith('unitId', 'U3', expect.any(Object));
  });

  it('no sobreescribe campos dirty en re-scan', async () => {
    const values: Record<string, string> = { patientId: 'A', unitId: 'U1' };
    const dirtiness: Record<string, boolean> = { patientId: true, unitId: false };
    const setValueSpy = vi.fn();

    mockUseZodForm.mockReturnValue({
      control: {},
      formState: {},
      handleSubmit: (fn: any) => fn,
      getValues: (field: string) => values[field],
      getFieldState: (field: string) => ({ isDirty: dirtiness[field] }),
      setValue: (field: string, value: string, options: unknown) => {
        values[field] = value;
        setValueSpy(field, value, options);
      },
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <HandoverForm
          navigation={navigation}
          route={{
            key: 'test',
            name: 'HandoverForm',
            params: { patientId: 'A', unitId: 'U1' },
          } as any}
        />
      );
    });

    setValueSpy.mockClear();

    await act(async () => {
      renderer!.update(
        <HandoverForm
          navigation={navigation}
          route={{
            key: 'test',
            name: 'HandoverForm',
            params: { patientId: 'B', unitId: 'U2' },
          } as any}
        />
      );
    });

    expect(setValueSpy).not.toHaveBeenCalledWith(
      'patientId',
      'B',
      expect.objectContaining({ shouldDirty: false })
    );
    expect(setValueSpy).toHaveBeenCalledWith(
      'unitId',
      'U2',
      expect.objectContaining({ shouldDirty: false })
    );
  });
});
