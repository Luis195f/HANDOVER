type SummaryInputs = {
  patientName: string;
  diagnosis?: string;
  news2Score?: number;
  keyFindings?: string[];
  pending?: string[];
  sttText?: string;
};

export function buildHandoverSummary(i: SummaryInputs) {
  const lines: string[] = [];
  lines.push(`Paciente: ${i.patientName}`);
  if (i.diagnosis) lines.push(`Dx: ${i.diagnosis}`);
  if (typeof i.news2Score === "number") lines.push(`NEWS2: ${i.news2Score}`);
  if (i.keyFindings?.length) lines.push(`Hallazgos: ${i.keyFindings.join("; ")}`);
  if (i.pending?.length) lines.push(`Pendientes: ${i.pending.join("; ")}`);
  if (i.sttText) lines.push(`(Dictado) ${i.sttText}`);

  return lines.join("\n");
}
