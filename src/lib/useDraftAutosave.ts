// src/lib/useDraftAutosave.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveDraft, getDraft, clearDraft } from "@/src/lib/drafts";

/**
 * Mini hook para autosave de borradores por paciente.
 *
 * Uso típico con react-hook-form:
 *   const form = useForm<FormValues>({...})
 *   const draft = useDraftAutosave<FormValues>({
 *     patientId,
 *     enabled: true,
 *     delay: 800,
 *     getSnapshot: () => form.getValues(),
 *     onLoad: (data) => form.reset({ ...form.getValues(), ...data }),
 *   })
 *   // Opcional: suscribirse a cambios del form
 *   useEffect(() => {
 *     const sub = form.watch(() => draft.scheduleSave());
 *     return () => (typeof sub === "function" ? sub() : sub?.unsubscribe?.());
 *   }, [form, draft]);
 */

export type UseDraftAutosaveOptions<T> = {
  /** Identificador de paciente (clave de draft). Si no hay, el hook no hace nada. */
  patientId?: string;
  /** Debounce en ms para el autosave. */
  delay?: number;
  /** Activa/desactiva completamente el autosave. */
  enabled?: boolean;
  /** Debe devolver un objeto JSON-serializable con el estado a guardar. */
  getSnapshot: () => T;
  /** Se llama al cargar un draft existente (para volcarlo al form). */
  onLoad?: (data: T) => void;
};

export type UseDraftAutosaveReturn = {
  /** Carga el draft (si existe) y lo entrega vía onLoad; devuelve el objeto. */
  loadNow: () => Promise<any | undefined>;
  /** Guarda inmediatamente (sin debounce). */
  saveNow: () => Promise<void>;
  /** Programa un guardado (respeta debounce). */
  scheduleSave: () => void;
  /** Limpia el draft del paciente. */
  clear: () => Promise<void>;
  /** Estado útil para UI/telemetría. */
  status: {
    enabled: boolean;
    pending: boolean;
    lastSavedAt?: number;
    loadedAt?: number;
    lastError?: string;
  };
};

/** Pequeña utilidad para garantizar que el snapshot sea serializable. */
function serialize<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    // Si no es 100% serializable, intentamos salvar lo posible
    return v as T;
  }
}

export function useDraftAutosave<T = any>(
  opts: UseDraftAutosaveOptions<T>
): UseDraftAutosaveReturn {
  const { patientId, delay = 800, enabled = true, getSnapshot, onLoad } = opts;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [pending, setPending] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [loadedAt, setLoadedAt] = useState<number | undefined>(undefined);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const loadNow = useCallback(async () => {
    if (!enabled || !patientId) return undefined;
    try {
      const data = await getDraft(patientId);
      if (data && onLoad) onLoad(data as T);
      if (mountedRef.current) setLoadedAt(Date.now());
      return data;
    } catch (err: any) {
      if (mountedRef.current) setLastError(String(err?.message ?? err));
      return undefined;
    }
  }, [enabled, patientId, onLoad]);

  const saveNow = useCallback(async () => {
    if (!enabled || !patientId) return;
    try {
      const snap = serialize(getSnapshot());
      await saveDraft(patientId, snap);
      if (!mountedRef.current) return;
      setLastSavedAt(Date.now());
      setPending(false);
      setLastError(undefined);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setPending(false);
      setLastError(String(err?.message ?? err));
    }
  }, [enabled, patientId, getSnapshot]);

  const scheduleSave = useCallback(() => {
    if (!enabled || !patientId) return;
    setPending(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Ejecutamos el guardado real
      saveNow();
    }, Math.max(0, delay));
  }, [enabled, patientId, delay, saveNow]);

  const clear = useCallback(async () => {
    if (!patientId) return;
    try {
      await clearDraft(patientId);
      if (mountedRef.current) {
        setPending(false);
        setLastSavedAt(undefined);
        setLastError(undefined);
      }
    } catch (err: any) {
      if (mountedRef.current) setLastError(String(err?.message ?? err));
    }
  }, [patientId]);

  const status = useMemo(
    () => ({ enabled, pending, lastSavedAt, loadedAt, lastError }),
    [enabled, pending, lastSavedAt, loadedAt, lastError]
  );

  return { loadNow, saveNow, scheduleSave, clear, status };
}

export default useDraftAutosave;
