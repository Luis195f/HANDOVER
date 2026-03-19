import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const ONCOLOGY_HEMATOLOGY_OVERLAY_RUNTIME_PACK = {
  id: 'onc',
  label: 'Overlay onco-hematologico',
  enabledSections: ['examenes', 'outcomes'],
  requiredExtraFields: ['Fase terapeutica', 'Inmunosupresion', 'CVC', 'Sintoma toxico dominante'],
  optionalExtraFields: ['Transfusion cuando aplique', 'Paliacion / objetivos de cuidado cuando aplique'],
  focusAreas: [
    'Toxicidad, neutropenia e inmunosupresion con explicabilidad clinica',
    'CVC, extravasacion y complicaciones de tratamiento sistemico',
    'Dolor, hidratacion y soporte anticipatorio durante el relevo',
  ],
  explanations: [
    'EOPROP-IA refuerza vigilancia onco-hematologica sobre el mismo formulario sin crear una pantalla nueva.',
    'Prioriza deterioro infeccioso, toxicidad y continuidad terapeutica con salida breve reutilizable.',
  ],
  scales: ['NEWS2', 'EVA', 'Escalas sintomaticas locales'],
  sentinelEvents: [
    'Neutropenia febril',
    'Sepsis',
    'Extravasacion',
    'Dolor no controlado',
    'Deshidratacion',
    'Complicaciones de tratamiento sistemico',
  ],
  quickPicks: {
    treatments: [
      {
        id: 'onc-neutropenia-reeval',
        type: 'other',
        description: 'Confirmar fiebre/neutropenia, cultivos y escalado precoz si el contexto lo exige',
      },
      {
        id: 'onc-extravasation-check',
        type: 'other',
        description: 'Verificar acceso/CVC, extravasacion y via segura antes de continuar terapia sistemica',
      },
      {
        id: 'onc-transfusion-safety',
        type: 'other',
        description: 'Completar doble chequeo de transfusion, tolerancia y respuesta clinica',
      },
      {
        id: 'onc-symptom-reeval',
        type: 'other',
        description: 'Reevaluar dolor, hidratacion y sintomas toxicos dominantes antes del cierre',
      },
    ],
  },
  visibleOutputs: [
    'Quien primero: fiebre, sepsis, extravasacion o dolor no controlado',
    'Por que: inmunosupresion, CVC y toxicidad sistemica aumentan deterioro',
    'No omitir: transfusion, acceso vascular, analgesia y vigilancia infecciosa',
    'Cuando reevaluar: este turno ante fiebre, dolor refractario o hidratacion comprometida',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'onc' };
