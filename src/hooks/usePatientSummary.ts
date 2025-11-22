// BEGIN HANDOVER: PATIENT_HEADER_HOOK
import { useEffect, useState } from 'react';

import { fetchFHIR } from '@/src/lib/fhir-client';

type PatientResource = {
  id?: string;
  birthDate?: string;
  name?: Array<{ family?: string; given?: string[]; text?: string }>;
  identifier?: Array<{ system?: string; type?: { text?: string }; value?: string }>;
};

export interface PatientSummary {
  id: string;
  displayName: string;
  ageLabel: string;
  bedLabel: string;
}

interface UsePatientSummaryState {
  loading: boolean;
  error: string | null;
  summary: PatientSummary | null;
}

export function usePatientSummary(patientId?: string): UsePatientSummaryState {
  const [state, setState] = useState<UsePatientSummaryState>({
    loading: !!patientId,
    error: null,
    summary: null,
  });

  useEffect(() => {
    if (!patientId) {
      setState({ loading: false, error: null, summary: null });
      return;
    }

    const targetId = patientId;
    let cancelled = false;
    async function load(targetId: string) {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const path = targetId.startsWith('Patient/')
          ? targetId
          : `Patient/${encodeURIComponent(targetId)}`;
        const result = await fetchFHIR({ path });
        if (cancelled) return;
        if (!result.ok || !result.data) {
          throw new Error('patient_not_found');
        }

        const patient = result.data as PatientResource;
        const summary = buildPatientSummaryFromResource(patient);
        setState({ loading: false, error: null, summary });
      } catch (err: any) {
        if (cancelled) return;
        setState({
          loading: false,
          error: 'No se pudieron obtener datos del paciente.',
          summary: {
            id: targetId,
            displayName: `Paciente #${targetId}`,
            ageLabel: 'Edad desconocida',
            bedLabel: 'Cama no registrada',
          },
        });
      }
    }

    load(targetId);
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return state;
}
// END HANDOVER: PATIENT_HEADER_HOOK

// BEGIN HANDOVER: PATIENT_HEADER_HELPERS
export function buildPatientSummaryFromResource(patient: PatientResource): PatientSummary {
  const id = patient.id ?? 'desconocido';
  const displayName = extractPatientDisplayName(patient);
  const ageLabel = buildAgeLabel(patient.birthDate);
  const bedLabel = extractBedLabel(patient);

  return { id, displayName, ageLabel, bedLabel };
}

function extractPatientDisplayName(patient: PatientResource): string {
  const name = (patient.name && patient.name[0]) || undefined;
  if (!name) return 'Paciente sin nombre';
  const family = name.family ?? '';
  const given = (name.given && name.given.join(' ')) || '';
  const full = `${given} ${family}`.trim();
  return full || 'Paciente sin nombre';
}

function buildAgeLabel(birthDate?: string): string {
  if (!birthDate) return 'Edad desconocida';
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return 'Edad desconocida';
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  const dayDiff = now.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }
  return years >= 0 ? `Edad ${years} años` : 'Edad desconocida';
}

function extractBedLabel(patient: PatientResource): string {
  const identifiers = patient.identifier ?? [];
  const bedIdentifier = identifiers.find((id) => {
    const system = id.system ?? '';
    const typeText = id.type?.text ?? '';
    return /bed|cama|room/i.test(system) || /bed|cama|habitación/i.test(typeText);
  });

  if (bedIdentifier?.value) {
    return `Cama ${bedIdentifier.value}`;
  }

  return 'Cama no registrada';
}
// END HANDOVER: PATIENT_HEADER_HELPERS
