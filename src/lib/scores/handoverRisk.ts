import type { HandoverValues } from '@/src/validation/schemas';

import { calculateBraden } from './braden';
import type { BradenInput } from './braden';
import { calculateNews2 } from './news2';
import type { News2Input } from './news2';
import { evaluateRisk, type RiskEvaluation } from './riskRules';

type PartialHandoverVitals = HandoverValues['vitals'];
type PartialOxygenTherapy = HandoverValues['oxygenTherapy'];

function buildNews2Input(
  vitals?: PartialHandoverVitals,
  oxygenTherapy?: PartialOxygenTherapy,
): News2Input | null {
  const hasOxygenValues = Object.values(oxygenTherapy ?? {}).some(
    (value) => value !== undefined && value !== null && value !== '',
  );

  const input: News2Input = {
    respiratoryRate: vitals?.rr ?? null,
    spo2: vitals?.spo2 ?? null,
    systolicBP: vitals?.sbp ?? null,
    heartRate: vitals?.hr ?? null,
    temperature: vitals?.tempC ?? null,
    consciousness: vitals?.avpu ?? null,
    onOxygen: hasOxygenValues ? true : null,
  };

  const hasAnyField = Object.values(input).some((value) => value !== null);
  return hasAnyField ? input : null;
}

function buildBradenInput(braden?: HandoverValues['braden']): BradenInput | null {
  if (!braden) return null;
  const input: BradenInput = {
    sensoryPerception: braden.sensoryPerception ?? null,
    moisture: braden.moisture ?? null,
    activity: braden.activity ?? null,
    mobility: braden.mobility ?? null,
    nutrition: braden.nutrition ?? null,
    frictionShear: braden.frictionShear ?? null,
  };

  const hasAnyField = Object.values(input).some((value) => value !== null);
  return hasAnyField ? input : null;
}

export function deriveRiskEvaluationFromValues(
  vitals?: PartialHandoverVitals,
  braden?: HandoverValues['braden'],
  oxygenTherapy?: PartialOxygenTherapy,
): RiskEvaluation {
  const newsInput = buildNews2Input(vitals, oxygenTherapy);
  const bradenInput = buildBradenInput(braden);
  const news2 = newsInput ? calculateNews2(newsInput) : null;
  const bradenScore = bradenInput ? calculateBraden(bradenInput) : null;

  return evaluateRisk(news2, bradenScore);
}

export async function confirmHighRiskSubmission(
  status: HandoverValues['status'] | undefined,
  evaluation: RiskEvaluation,
  alertFn: (title: string, message?: string, buttons?: Array<{ text?: string; style?: string; onPress?: () => void }>) => void,
): Promise<boolean> {
  if (status === 'draft' || evaluation.level !== 'high') {
    return true;
  }

  return new Promise((resolve) => {
    alertFn(
      'Riesgo clínico alto',
      'Se han detectado riesgos clínicos altos (ej. NEWS2/Braden). Confirma que has revisado y gestionado estos riesgos antes de cerrar el relevo.',
      [
        { text: 'Volver al formulario', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirmar y enviar', onPress: () => resolve(true) },
      ],
    );
  });
}
