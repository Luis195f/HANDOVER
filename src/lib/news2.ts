import * as Notifications from 'expo-notifications';

const { Vibration } = require('react-native') as {
  Vibration: { vibrate: (pattern: number | number[]) => void };
};

export type ACVPU = 'A' | 'C' | 'V' | 'P' | 'U';

export type NEWS2Input = {
  rr?: number;
  spo2?: number;
  temp?: number;
  sbp?: number;
  hr?: number;
  o2?: boolean;        // ¿usa oxígeno suplementario?
  avpu?: ACVPU;        // A/C/V/P/U (C es nueva confusión)
  scale2?: boolean;    // usar SpO2 Scale 2 (hipercápnicos, COPD, etc.)
};

export type NEWS2Breakdown = {
  rr: number; spo2: number; o2: number; temp: number; sbp: number; hr: number; avpu: number;
  total: number;
  anyThree: boolean;
  band: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRÍTICA';
};

function sRR(rr?: number) {
  if (rr == null) return 0;
  if (rr <= 8) return 3;
  if (rr >= 9 && rr <= 11) return 1;
  if (rr >= 12 && rr <= 20) return 0;
  if (rr >= 21 && rr <= 24) return 2;
  return 3; // >=25
}

function sSpO2_scale1(spo2?: number) {
  if (spo2 == null) return 0;
  if (spo2 <= 91) return 3;
  if (spo2 <= 93) return 2;     // 92–93
  if (spo2 <= 95) return 1;     // 94–95
  return 0;                     // >=96
}

// Scale 2 (NEWS2): usar solo si clínicamente indicado (ej. objetivo 88–92%).
// Umbrales según gráfico oficial RCP (Chart 1). Ver notas.
function sSpO2_scale2(spo2?: number, onO2?: boolean) {
  if (spo2 == null) return 0;
  if (spo2 <= 83) return 3;
  if (spo2 <= 85) return 2;       // 84–85
  if (spo2 <= 87) return 1;       // 86–87
  if (spo2 <= 92) return 0;       // 88–92
  // >=93: depende del uso de oxígeno
  if (!onO2) return 1;            // ≥93 en aire
  if (spo2 <= 96) return 2;       // 93–96 en oxígeno
  return 3;                       // ≥97 en oxígeno
}

function sTemp(t?: number) {
  if (t == null) return 0;
  if (t <= 35.0) return 3;
  if (t <= 36.0) return 1;
  if (t <= 38.0) return 0;
  if (t <= 39.0) return 1;
  return 2; // >=39.1
}

function sSBP(sbp?: number) {
  if (sbp == null) return 0;
  if (sbp <= 90) return 3;
  if (sbp <= 100) return 2;
  if (sbp <= 110) return 1;
  if (sbp <= 219) return 0;
  return 3; // >=220
}

function sHR(hr?: number) {
  if (hr == null) return 0;
  if (hr <= 40) return 3;
  if (hr <= 50) return 1;
  if (hr <= 90) return 0;
  if (hr <= 110) return 1;
  if (hr <= 130) return 2;
  return 3; // >=131
}

function sAVPU(avpu?: ACVPU) {
  if (!avpu || avpu === 'A') return 0;
  return 3; // C, V, P o U
}

export function computeNEWS2(inp: NEWS2Input): NEWS2Breakdown {
  const rr = sRR(inp.rr);
  const spo2 = inp.scale2 ? sSpO2_scale2(inp.spo2, inp.o2) : sSpO2_scale1(inp.spo2);
  const o2 = inp.o2 ? 2 : 0; // fila "Air or oxygen?" = 2 puntos si usa O2
  const temp = sTemp(inp.temp);
  const sbp = sSBP(inp.sbp);
  const hr = sHR(inp.hr);
  const avpu = sAVPU(inp.avpu);

  const parts = [rr, spo2, o2, temp, sbp, hr, avpu];
  const total = parts.reduce((a,b)=>a+b, 0);
  const anyThree = parts.some(x => x === 3);

  // Bandas (RCP): >=7 alto; 5–6 urgente; cualquier 3 es "red flag"
  let band: NEWS2Breakdown['band'] = 'BAJA';
  if (total >= 7) band = 'CRÍTICA';
  else if (total >= 5 || anyThree) band = 'ALTA';
  else if (total >= 1) band = 'MEDIA';

  return { rr, spo2, o2, temp, sbp, hr, avpu, total, anyThree, band };
}

export async function alertIfCritical(score: number) {
  if (score >= 7) {
    Vibration.vibrate(800);
    await Notifications.scheduleNotificationAsync({
      content: { title: '¡Paciente crítico!', body: `NEWS2 = ${score}` },
      trigger: null,
    });
  }
}
