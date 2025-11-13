// BEGIN HANDOVER: LOGGER
type Level = "debug" | "info" | "warn" | "error";
const PHI_KEYS = ["name", "fullName", "document", "bed", "mrn", "hc", "history", "dni"];
const redactPII = (obj: any) =>
  JSON.parse(
    JSON.stringify(obj, (k, v) => (PHI_KEYS.includes(k) ? "***" : v))
  );
export const logger = {
  log: (lvl: Level, msg: string, meta?: any) => {
    const safe = meta ? redactPII(meta) : undefined;
    console[lvl](`[${lvl.toUpperCase()}] ${msg}`, safe ?? "");
  }
};
// END HANDOVER: LOGGER
