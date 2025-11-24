export interface BradenInput {
  sensoryPerception: number | null;
  moisture: number | null;
  activity: number | null;
  mobility: number | null;
  nutrition: number | null;
  frictionShear: number | null;
}

export interface BradenResult {
  total: number;
  subscaleScores: Partial<Record<keyof BradenInput, number>>;
}

export function calculateBraden(input: BradenInput): BradenResult {
  const subscaleScores: BradenResult['subscaleScores'] = {
    sensoryPerception:
      input.sensoryPerception == null ? Number.NaN : Number(input.sensoryPerception),
    moisture: input.moisture == null ? Number.NaN : Number(input.moisture),
    activity: input.activity == null ? Number.NaN : Number(input.activity),
    mobility: input.mobility == null ? Number.NaN : Number(input.mobility),
    nutrition: input.nutrition == null ? Number.NaN : Number(input.nutrition),
    frictionShear: input.frictionShear == null ? Number.NaN : Number(input.frictionShear),
  };

  const total = (Object.values(subscaleScores) as number[]).reduce((acc, value) => {
    if (Number.isNaN(value)) return acc;
    return acc + value;
  }, 0);

  return { total, subscaleScores };
}
