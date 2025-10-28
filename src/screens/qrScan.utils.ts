export const extractPatientId = (raw: string): string | null => {
  // 1) URL estilo FHIR "Patient/{id}" o ".../Patient/{id}"
  const patientUrlMatch = raw.match(/(?:^|\/)Patient\/([A-Za-z0-9\-.]+)/);
  if (patientUrlMatch?.[1]) {
    return patientUrlMatch[1];
  }

  // 2) JSON FHIR Patient o Bundle con entrada Patient
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.resourceType === 'Patient' && typeof obj.id === 'string') {
      return obj.id;
    }

    if (obj?.resourceType === 'Bundle' && Array.isArray(obj.entry)) {
      const patientEntry = obj.entry.find(
        (entry: any) => entry?.resource?.resourceType === 'Patient' && entry?.resource?.id,
      );
      if (patientEntry?.resource?.id) {
        return String(patientEntry.resource.id);
      }
    }
  } catch {
    // not JSON
  }

  // 3) HL7v2 mini-parser (buscar segmento PID y tomar PID-3)
  const pidLine = raw.split(/\r?\n/).find((line) => line.startsWith('PID|'));
  if (pidLine) {
    const fields = pidLine.split('|');
    const pid3 = fields[3] ?? '';
    const firstId = String(pid3).split('^')[0];
    if (firstId) {
      return firstId;
    }
  }

  return null;
};

type HandleScanArgs = {
  data: string;
  navigate: (patientId: string) => void;
  onUnrecognized: () => void;
};

export const handleScanResult = ({ data, navigate, onUnrecognized }: HandleScanArgs): boolean => {
  const patientId = extractPatientId(data);
  if (!patientId) {
    onUnrecognized();
    return false;
  }

  navigate(patientId);
  return true;
};

