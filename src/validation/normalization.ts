export const GLUCOSE_MMOL_TO_MGDL_FACTOR = 18.0182;

type CanonicalRiskType =
  | 'fall'
  | 'pressureUlcer'
  | 'isolation'
  | 'seizure'
  | 'suicide'
  | 'deviceDisconnection'
  | 'infection'
  | 'other';

const LEGACY_RISK_ALIASES: Record<string, CanonicalRiskType> = {
  fall: 'fall',
  caida: 'fall',
  caidas: 'fall',
  pressureulcer: 'pressureUlcer',
  pressure_ulcer: 'pressureUlcer',
  ulcerapresion: 'pressureUlcer',
  ulcerasporpresion: 'pressureUlcer',
  isolation: 'isolation',
  aislamiento: 'isolation',
  seizure: 'seizure',
  convulsion: 'seizure',
  suicide: 'suicide',
  suicidio: 'suicide',
  devicedisconnection: 'deviceDisconnection',
  desconexiondispositivo: 'deviceDisconnection',
  infection: 'infection',
  infeccion: 'infection',
  other: 'other',
  otro: 'other',
};

const normalizeRiskLegacyToken = (value: string): CanonicalRiskType => {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
  return LEGACY_RISK_ALIASES[normalized] ?? 'other';
};

const ensureObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>) : {};

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const normalizeLegacyDxNursingText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const display = typeof record.display === 'string' ? record.display.trim() : '';
    if (display) return display;
    const code = typeof record.code === 'string' ? record.code.trim() : '';
    return code || undefined;
  }
  return undefined;
};

export const glucoseMmolLToMgDl = (value: number, decimals = 0): number =>
  Number((value * GLUCOSE_MMOL_TO_MGDL_FACTOR).toFixed(decimals));

export const glucoseMgDlToMmolL = (value: number, decimals = 1): number =>
  Number((value / GLUCOSE_MMOL_TO_MGDL_FACTOR).toFixed(decimals));

export const normalizeLegacyHandoverPayload = (input: unknown): unknown => {
  const payload = ensureObject(input);

  const vitals = ensureObject(payload.vitals);
  const glucoseMgDl = typeof vitals.glucoseMgDl === 'number' ? vitals.glucoseMgDl : undefined;
  const glucoseMmolL = typeof vitals.glucoseMmolL === 'number' ? vitals.glucoseMmolL : undefined;

  if (glucoseMgDl === undefined && glucoseMmolL !== undefined) {
    vitals.glucoseMgDl = glucoseMmolLToMgDl(glucoseMmolL);
  }

  if (typeof vitals.glucoseMgDl === 'number') {
    vitals.glucoseMmolL = glucoseMgDlToMmolL(vitals.glucoseMgDl);
  }

  payload.vitals = vitals;

  const medications = Array.isArray(payload.medications) ? [...payload.medications] : [];
  const meds = payload.meds;

  if (Array.isArray(meds)) {
    payload.meds = meds.join(', ');
  }

  if (medications.length === 0 && (typeof meds === 'string' || Array.isArray(meds))) {
    const medsText = Array.isArray(meds) ? meds.join(', ') : meds;
    const items = medsText
      .split(/[\n,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item, index) => ({ id: `legacy-med-${index + 1}`, name: item }));

    if (items.length > 0) {
      payload.medications = items;
    }
  }

  if (!hasText(payload.meds) && Array.isArray(payload.medications) && payload.medications.length > 0) {
    const derivedMeds = payload.medications
      .map((item) => (item && typeof item === 'object' && hasText((item as { name?: unknown }).name)
        ? (item as { name: string }).name.trim()
        : ''))
      .filter(Boolean)
      .join(', ');
    if (derivedMeds) {
      payload.meds = derivedMeds;
    }
  }

  const risksStructured = Array.isArray(payload.risksStructured) ? [...payload.risksStructured] : [];
  const legacyRisks = payload.risks;

  if (Array.isArray(legacyRisks)) {
    payload.risks = {};
  }

  if (risksStructured.length === 0 && Array.isArray(legacyRisks)) {
    payload.risksStructured = legacyRisks
      .map((risk) => (typeof risk === 'string' ? risk.trim() : ''))
      .filter(Boolean)
      .map((risk) => ({
        type: normalizeRiskLegacyToken(risk),
        present: true,
        notes: `Migrado de risks[]: ${risk}`,
        actions: [],
      }));
  }

  const risksFlags = ensureObject(payload.risks);
  const hasExplicitFlags = ['fall', 'pressureUlcer', 'isolation'].some((key) => typeof risksFlags[key] === 'boolean');
  if (!hasExplicitFlags && Array.isArray(payload.risksStructured)) {
    const presentTypes = new Set(
      payload.risksStructured
        .filter((item) => item && typeof item === 'object' && (item as { present?: unknown }).present === true)
        .map((item) => String((item as { type?: unknown }).type)),
    );
    payload.risks = {
      ...risksFlags,
      fall: presentTypes.has('fall'),
      pressureUlcer: presentTypes.has('pressureUlcer'),
      isolation: presentTypes.has('isolation'),
    };
  }

  const closingSummary = hasText(payload.closingSummary) ? payload.closingSummary.trim() : '';
  const sbarFullText = hasText(payload.sbarFullText) ? payload.sbarFullText.trim() : '';

  if (!closingSummary && sbarFullText) {
    payload.closingSummary = sbarFullText;
  }

  if (!sbarFullText && hasText(payload.closingSummary)) {
    payload.sbarFullText = payload.closingSummary.trim();
  }

  const dxNursingStructured = Array.isArray(payload.dxNursingStructured) ? payload.dxNursingStructured : [];
  const normalizedDxNursing = normalizeLegacyDxNursingText(payload.dxNursing);

  if (normalizedDxNursing) {
    payload.dxNursing = normalizedDxNursing;
  } else if (dxNursingStructured.length > 0) {
    const firstNanda = dxNursingStructured.find((item) =>
      item && typeof item === 'object' && (item as { system?: unknown }).system === 'NANDA',
    ) as { code?: unknown; display?: unknown } | undefined;

    const display = typeof firstNanda?.display === 'string' ? firstNanda.display.trim() : '';
    if (display) {
      payload.dxNursing = display;
    }
  } else {
    payload.dxNursing = undefined;
  }

  return payload;
};
