import { computeNEWS2 } from '../news2';

export interface News2Input {
  respiratoryRate: number | null;
  spo2: number | null;
  systolicBP: number | null;
  heartRate: number | null;
  temperature: number | null;
  consciousness: 'A' | 'C' | 'V' | 'P' | 'U' | null;
  onOxygen: boolean | null;
}

export interface News2Result {
  total: number;
  componentScores: Partial<Record<keyof News2Input, number>>;
}

export function calculateNews2(input: News2Input): News2Result {
  const breakdown = computeNEWS2({
    rr: input.respiratoryRate ?? undefined,
    spo2: input.spo2 ?? undefined,
    sbp: input.systolicBP ?? undefined,
    hr: input.heartRate ?? undefined,
    temp: input.temperature ?? undefined,
    avpu: input.consciousness ?? undefined,
    o2: input.onOxygen ?? undefined,
  });

  const componentScores: News2Result['componentScores'] = {
    respiratoryRate: input.respiratoryRate == null ? Number.NaN : breakdown.rr,
    spo2: input.spo2 == null ? Number.NaN : breakdown.spo2,
    systolicBP: input.systolicBP == null ? Number.NaN : breakdown.sbp,
    heartRate: input.heartRate == null ? Number.NaN : breakdown.hr,
    temperature: input.temperature == null ? Number.NaN : breakdown.temp,
    consciousness: input.consciousness == null ? Number.NaN : breakdown.avpu,
    onOxygen: input.onOxygen == null ? Number.NaN : breakdown.o2,
  };

  return { total: breakdown.total, componentScores };
}
