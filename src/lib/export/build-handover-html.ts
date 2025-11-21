import type { HandoverValues } from '../../types/handover';
import type { HandoverSession } from '../../security/auth-types';

export interface HandoverPdfContext {
  handover: HandoverValues & {
    id?: string;
    sbar?: {
      situation?: string | null;
      background?: string | null;
      assessment?: string | null;
      recommendation?: string | null;
    } | null;
  };
  user: HandoverSession;
  generatedAt: string;
}

export function buildHandoverHtml(ctx: HandoverPdfContext): string {
  const { handover, user, generatedAt } = ctx;

  const sbar = handover.sbar ?? {
    situation: handover.sbarSituation ?? handover.closingSummary ?? '',
    background: handover.sbarBackground ?? '',
    assessment: handover.sbarAssessment ?? '',
    recommendation: handover.sbarRecommendation ?? '',
  };

  const safe = (value: unknown) => (value == null ? '' : String(value));

  const administrativeData = handover.administrativeData ?? {
    unit: '',
    shiftStart: '',
    shiftEnd: '',
    census: 0,
    staffIn: [],
    staffOut: [],
  };

  return `
    <html>
      <head>
        <meta charSet="utf-8" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; }
          h1 { font-size: 22px; margin-bottom: 8px; }
          h2 { font-size: 18px; margin-top: 16px; margin-bottom: 4px; }
          p, li { font-size: 14px; line-height: 1.4; }
          .section { margin-bottom: 12px; }
          .meta { font-size: 12px; color: #555; }
          .signature { margin-top: 24px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>Informe de Entrega de Turno – Handover Pro</h1>

        <div class="section meta">
          <p><strong>Unidad:</strong> ${safe(administrativeData.unit)}</p>
          <p><strong>Turno:</strong> ${safe(administrativeData.shiftStart)} – ${safe(administrativeData.shiftEnd)}</p>
          <p><strong>ID Paciente:</strong> ${safe(handover.patientId)}</p>
        </div>

        <div class="section">
          <h2>Situation</h2>
          <p>${safe(sbar.situation)}</p>
        </div>

        <div class="section">
          <h2>Background</h2>
          <p>${safe(sbar.background)}</p>
        </div>

        <div class="section">
          <h2>Assessment</h2>
          <p>${safe(sbar.assessment)}</p>
        </div>

        <div class="section">
          <h2>Recommendation</h2>
          <p>${safe(sbar.recommendation)}</p>
        </div>

        <div class="signature">
          <p>Firmado digitalmente (simulado) por: <strong>${safe(user.displayName ?? user.userId)}</strong></p>
          <p>ID usuario: ${safe(user.userId ?? '')}</p>
          <p>Fecha/hora: ${safe(generatedAt)}</p>
        </div>
      </body>
    </html>
  `;
}
