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
    durability: 'persisted' | 'memory' | 'failed';
  };
};

/** Pequeña utilidad para garantizar que el snapshot sea serializable. */
function serialize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function useDraftAutosave<T = any>(
  opts: UseDraftAutosaveOptions<T>
): UseDraftAutosaveReturn {
  const { patientId, delay = 800, enabled = true, getSnapshot, onLoad } = opts;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const loadFailedRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [loadedAt, setLoadedAt] = useState<number | undefined>(undefined);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const [durability, setDurability] = useState<'persisted' | 'memory' | 'failed'>('memory');

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
      loadFailedRef.current = false;
      if (data && onLoad) onLoad(data as T);
      if (mountedRef.current) setLoadedAt(Date.now());
      return data;
    } catch {
      loadFailedRef.current = true;
      if (mountedRef.current) setLastError('DRAFT_READ_FAILED');
      throw new Error('DRAFT_READ_FAILED');
    }
  }, [enabled, patientId, onLoad]);

  const saveNow = useCallback(async () => {
    if (!enabled || !patientId) return;
    try {
      if (loadFailedRef.current) throw new Error('DRAFT_READ_FAILED');
      const snap = serialize(getSnapshot());
      const result = await saveDraft(patientId, snap);
      if (!mountedRef.current) return;
      setDurability(result);
      setLastSavedAt(result === 'persisted' ? Date.now() : undefined);
      setPending(false);
      setLastError(undefined);
    } catch {
      if (!mountedRef.current) return;
      setPending(false);
      setDurability('failed');
      setLastError('DRAFT_SAVE_FAILED');
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
    () => ({ enabled, pending, lastSavedAt, loadedAt, lastError, durability }),
    [enabled, pending, lastSavedAt, loadedAt, lastError, durability]
  );

  return { loadNow, saveNow, scheduleSave, clear, status };
}

export default useDraftAutosave;
