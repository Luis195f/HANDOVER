// BEGIN HANDOVER: NEWS2
export type ACVPU = "A" | "C" | "V" | "P" | "U";

export type NEWS2Input = {
  rr?: number | null;
  spo2?: number | null;
  temp?: number | null;
  sbp?: number | null;
  hr?: number | null;
  o2?: boolean | null;
  avpu?: ACVPU | null;
  scale2?: boolean | null;
};

type ScoreParts = {
  rr: number;
  spo2: number;
  temp: number;
  sbp: number;
  hr: number;
  avpu: number;
  o2: number;
};

type Band = "BAJA" | "MEDIA" | "ALTA" | "CRÍTICA";

type Risk = "low" | "medium" | "high" | "critical";

const BAND_TO_RISK: Record<Band, { risk: Risk; level: string }> = {
  BAJA: { risk: "low", level: "Bajo" },
  MEDIA: { risk: "medium", level: "Moderado" },
  ALTA: { risk: "high", level: "Alto" },
  CRÍTICA: { risk: "critical", level: "Crítico" },
};

export type NEWS2Breakdown = {
  total: number;
  score: number;
  value: number;
  band: Band;
  risk: Risk;
  level: string;
  components: ScoreParts;
  modifiers: {
    supplementalO2: boolean;
    spo2Scale2: boolean;
  };
};

function sanitiseNumber(value?: number | null): number | undefined {
  if (value == null) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function scoreRespiratoryRate(value?: number) {
  if (value == null) return 0;
  if (value <= 8) return 3;
  if (value <= 11) return 1;
  if (value <= 20) return 0;
  if (value <= 24) return 2;
  return 3;
}

function scoreTemperature(value?: number) {
  if (value == null) return 0;
  if (value <= 35) return 3;
  if (value < 36) return 1;
  if (value <= 38) return 0;
  if (value <= 39) return 1;
  return 2;
}

function scoreSystolicBp(value?: number) {
  if (value == null) return 0;
  if (value <= 90) return 3;
  if (value <= 100) return 2;
  if (value <= 110) return 1;
  if (value <= 219) return 0;
  return 3;
}

function scoreHeartRate(value?: number) {
  if (value == null) return 0;
  if (value <= 40) return 3;
  if (value <= 50) return 1;
  if (value <= 90) return 0;
  if (value <= 110) return 1;
  if (value <= 130) return 2;
  return 3;
}

function scoreAvpu(value?: ACVPU | null) {
  if (!value || value === "A") return 0;
  return 3;
}

type Spo2Score = { score: number; scale2: boolean };

function scoreSpo2(value?: number, scale2?: boolean): Spo2Score {
  if (value == null) return { score: 0, scale2: Boolean(scale2) };
  const spo2 = value;
  if (scale2) {
    if (spo2 >= 97) return { score: 3, scale2: true };
    if (spo2 >= 95) return { score: 2, scale2: true };
    if (spo2 >= 93) return { score: 1, scale2: true };
    if (spo2 >= 88) return { score: 0, scale2: true };
    if (spo2 >= 86) return { score: 1, scale2: true };
    if (spo2 >= 84) return { score: 2, scale2: true };
    return { score: 3, scale2: true };
  }
  if (spo2 >= 96) return { score: 0, scale2: false };
  if (spo2 >= 94) return { score: 1, scale2: false };
  if (spo2 >= 92) return { score: 2, scale2: false };
  return { score: 3, scale2: false };
}

function supplementalO2Score(o2?: boolean | null) {
  return o2 ? 2 : 0;
}

function computeBand(score: number): Band {
  if (score >= 7) return "CRÍTICA";
  if (score >= 5) return "ALTA";
  if (score >= 3) return "MEDIA";
  return "BAJA";
}

export function computeNEWS2(input: NEWS2Input): NEWS2Breakdown {
  const rr = sanitiseNumber(input.rr);
  const spo2Value = sanitiseNumber(input.spo2);
  const temp = sanitiseNumber(input.temp);
  const sbp = sanitiseNumber(input.sbp);
  const hr = sanitiseNumber(input.hr);

  const spo2 = scoreSpo2(spo2Value, Boolean(input.scale2));

  const components: ScoreParts = {
    rr: scoreRespiratoryRate(rr),
    spo2: spo2.score,
    temp: scoreTemperature(temp),
    sbp: scoreSystolicBp(sbp),
    hr: scoreHeartRate(hr),
    avpu: scoreAvpu(input.avpu ?? null),
    o2: supplementalO2Score(input.o2 ?? null),
  };

  const total =
    components.rr +
    components.spo2 +
    components.temp +
    components.sbp +
    components.hr +
    components.avpu +
    components.o2;

  const band = computeBand(total);
  const { risk, level } = BAND_TO_RISK[band];

  return {
    total,
    score: total,
    value: total,
    band,
    risk,
    level,
    components,
    modifiers: {
      supplementalO2: Boolean(input.o2),
      spo2Scale2: spo2.scale2,
    },
  };
}

export function scoreNEWS2(input: NEWS2Input): number {
  return computeNEWS2(input).total;
}

export default computeNEWS2;
// END HANDOVER: NEWS2
