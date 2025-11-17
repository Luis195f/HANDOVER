import { describe, expect, it } from 'vitest';

import { zHandover, zVitals, zOxygen } from '@/src/validation/schemas';

describe('Validation schemas', () => {
  it('acepta valores mínimos requeridos para handover', () => {
    const result = zHandover.safeParse({
      administrativeData: {
        unit: 'icu',
        census: 0,
        staffIn: [],
        staffOut: [],
        shiftStart: '2024-01-01T00:00:00Z',
        shiftEnd: '2024-01-01T04:00:00Z',
        incidents: ['Sin incidentes'],
      },
      patientId: 'pat-001',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza handover sin unidad o paciente', () => {
    const result = zHandover.safeParse({
      administrativeData: {
        unit: '',
        census: 0,
        staffIn: [],
        staffOut: [],
        shiftStart: '',
        shiftEnd: '',
      },
      patientId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('La unidad es obligatoria');
      expect(messages).toContain('Inicio de turno requerido');
      expect(messages).toContain('Fin de turno requerido');
      expect(messages).toContain('ID paciente requerido');
    }
  });

  it('valida censo no negativo y orden de turno', () => {
    const result = zHandover.safeParse({
      administrativeData: {
        unit: 'icu',
        census: -2,
        staffIn: ['Alice'],
        staffOut: ['Bob'],
        shiftStart: '2024-01-01T04:00:00Z',
        shiftEnd: '2024-01-01T03:00:00Z',
      },
      patientId: 'pat-001',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('El censo no puede ser negativo');
      expect(messages).toContain('El fin del turno debe ser posterior al inicio');
    }
  });

  it('valida rangos fisiológicos en signos vitales', () => {
    const valid = zVitals.safeParse({ hr: 80, rr: 14, tempC: 36.5, spo2: 97, sbp: 120, dbp: 70 });
    expect(valid.success).toBe(true);

    const invalid = zVitals.safeParse({ hr: 10, spo2: 30 });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const messages = invalid.error.issues.map((issue) => issue.message);
      expect(messages.some((message) => message.includes('30'))).toBe(true);
      expect(messages.some((message) => message.includes('50'))).toBe(true);
    }
  });

  it('requiere porcentajes de oxígeno dentro de los límites', () => {
    const valid = zOxygen.safeParse({ device: 'cánula', flowLMin: 2, fio2: 28 });
    expect(valid.success).toBe(true);

    const invalid = zOxygen.safeParse({ flowLMin: 120, fio2: 150 });
    expect(invalid.success).toBe(false);
  });
});
