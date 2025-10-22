export type Unit = { id: string; name: string; type: "UCI"|"Hospitalización"|"Urgencias"|"Quirófano"|"Neonatología"|"Pediatría"|"Salud Mental"|"Ambulatorio"; };
export const UNITS: Unit[] = [
  { id: "uci-adulto", name: "UCI Adulto", type: "UCI" },
  { id: "urgencias", name: "Urgencias/Emergencias", type: "Urgencias" },
  { id: "med-interna", name: "Medicina Interna", type: "Hospitalización" },
  { id: "pediatria", name: "Pediatría", type: "Pediatría" },
  { id: "neonatologia", name: "Neonatología", type: "Neonatología" },
  { id: "quirófano", name: "Quirófanos/Recuperación", type: "Quirófano" },
  { id: "salud-mental", name: "Salud Mental", type: "Salud Mental" },
  { id: "ambulatorio", name: "Consulta Externa/Ambulatoria", type: "Ambulatorio" },
];
