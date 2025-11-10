import type { HandoverFormData } from '@/src/schemas/handover';

type BundleEntry = {
  request: { method: 'POST'; url: string };
  resource: Record<string, any>;
};

type Bundle = {
  resourceType: 'Bundle';
  type: 'transaction';
  entry: BundleEntry[];
};

function patientReference(id: string) {
  return { reference: `Patient/${id}` };
}

export function mapToFhirBundle(values: HandoverFormData): Bundle {
  const entries: BundleEntry[] = [];
  const subject = patientReference(values.patientId);

  const now = new Date().toISOString();

  if (values.evolution) {
    entries.push({
      request: { method: 'POST', url: 'Observation' },
      resource: {
        resourceType: 'Observation',
        status: 'final',
        category: [{ text: 'handover-note' }],
        code: { text: 'Clinical handover summary' },
        subject,
        effectiveDateTime: now,
        valueString: values.evolution,
      },
    });
  }

  Object.entries(values.vitals ?? {}).forEach(([key, value]) => {
    if (value == null) return;
    entries.push({
      request: { method: 'POST', url: 'Observation' },
      resource: {
        resourceType: 'Observation',
        status: 'final',
        category: [{ text: 'vital-signs' }],
        code: { text: `Vital - ${key}` },
        subject,
        effectiveDateTime: now,
        valueQuantity: {
          value,
          unit: key,
        },
      },
    });
  });

  values.meds.forEach((med) => {
    entries.push({
      request: { method: 'POST', url: 'MedicationStatement' },
      resource: {
        resourceType: 'MedicationStatement',
        status: 'active',
        medicationCodeableConcept: {
          text: med.name,
        },
        subject,
        effectiveDateTime: now,
        dosage: [
          {
            text: [med.dose, med.route, med.time].filter(Boolean).join(' '),
          },
        ],
      },
    });
  });

  values.dxList.forEach((diagnosis) => {
    entries.push({
      request: { method: 'POST', url: 'Condition' },
      resource: {
        resourceType: 'Condition',
        subject,
        recordedDate: now,
        code: { text: diagnosis },
      },
    });
  });

  Object.entries(values.risks ?? {}).forEach(([risk, enabled]) => {
    if (!enabled) return;
    entries.push({
      request: { method: 'POST', url: 'Observation' },
      resource: {
        resourceType: 'Observation',
        status: 'final',
        category: [{ text: 'risk' }],
        code: { text: `Risk - ${risk}` },
        subject,
        effectiveDateTime: now,
        valueCodeableConcept: {
          text: 'Positive',
        },
      },
    });
  });

  entries.push({
    request: { method: 'POST', url: 'Composition' },
    resource: {
      resourceType: 'Composition',
      status: 'final',
      type: { text: 'Clinical handover' },
      subject,
      date: now,
      title: `Handover ${values.patientId}`,
      author: [
        {
          display: `${values.admin.staffOut} → ${values.admin.staffIn}`,
        },
      ],
      section: [
        {
          title: 'Administrative summary',
          text: {
            status: 'generated',
            div: `Unidad: ${values.admin.unit}; Censo: ${values.admin.census}`,
          },
        },
      ],
    },
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}
