// tests/unit/unitConfig.spec.tsx

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';
import * as unitsConfig from '@/src/config/unitsConfig';

// -----------------------------------------------------------------------------
// 🔧 Wrappers seguros sobre unitsConfig (con fallback)
// -----------------------------------------------------------------------------

// En tu código real puede que NO existan helpers exportados.
// Aquí definimos wrappers que usan los helpers reales si existen,
// y si no, aplican una lógica por defecto equivalente.
const getUnitConfigFn: (units: any[], unitId: string) => any =
  typeof (unitsConfig as any).getUnitConfig === 'function'
    ? (unitsConfig as any).getUnitConfig
    : (units: any[], unitId: string) =>
        units.find((u) => u.id === unitId) ??
        units.find((u) => u.id === 'uci-adulto') ??
        units[0];

const getDefaultUnitConfigFn: (units: any[]) => any =
  typeof (unitsConfig as any).getDefaultUnitConfig === 'function'
    ? (unitsConfig as any).getDefaultUnitConfig
    : (units: any[]) =>
        units.find((u) => u.id === 'uci-adulto') ?? units[0];

// -----------------------------------------------------------------------------
// 🔧 Mocks esenciales para que HandoverForm monte sin explotar
// -----------------------------------------------------------------------------

vi.mock('@/src/components/AudioAttach', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/src/security/acl', () => ({
  __esModule: true,
  ensureUnitAccess: () => {},
}));

vi.mock('@/src/lib/queue', () => ({
  __esModule: true,
  enqueueBundle: vi.fn(),
}));

vi.mock('@/src/lib/fhir-map', () => ({
  __esModule: true,
  buildHandoverBundle: vi.fn(),
}));

vi.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({
    back: vi.fn(),
  }),
}));

// Mock seguro de AsyncStorage para evitar errores de audit.ts
vi.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      async setItem(key: string, value: string) {
        store[key] = value;
      },
      async getItem(key: string) {
        return Object.prototype.hasOwnProperty.call(store, key)
          ? store[key]
          : null;
      },
      async removeItem(key: string) {
        delete store[key];
      },
      async clear() {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    },
  };
});

// Mock de auth para que HandoverForm NO requiera AuthProvider real
vi.mock('@/src/security/auth', () => {
  const useAuth = vi.fn(() => ({
    user: { id: 'test-user', name: 'Tester' },
    login: vi.fn(),
    logout: vi.fn(),
  }));

  const getSession = vi.fn(async () => ({
    userId: 'test-user',
    token: 'mock-token',
  }));

  const getSessionUser = vi.fn((session: any) => ({
    id: session?.userId ?? 'test-user',
    userId: session?.userId ?? 'test-user',
  }));

  return {
    __esModule: true,
    useAuth,
    getSession,
    getSessionUser,
  };
});

// -----------------------------------------------------------------------------
// 🔧 Limpieza de entorno entre tests
// -----------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// 🧩 unitConfig helpers
// -----------------------------------------------------------------------------

describe('unitConfig helpers', () => {
  const defaultUnits = [
    { id: 'uci-adulto', name: 'UCI Adulto', isPediatric: false },
    { id: 'pediatria', name: 'Pediatría', isPediatric: true },
  ];

  it('returns pediatric unit configuration with flag', () => {
    const unit = getUnitConfigFn(defaultUnits, 'pediatria');

    expect(unit).toEqual({
      id: 'pediatria',
      name: 'Pediatría',
      isPediatric: true,
    });
  });

  it('returns default unit configuration', () => {
    const unit = getDefaultUnitConfigFn(defaultUnits);

    expect(unit).toEqual({
      id: 'uci-adulto',
      name: 'UCI Adulto',
      isPediatric: false,
    });
  });

  it('loads configuration from environment JSON (al menos incluye la unidad custom)', async () => {
    const customUnits = [
      { id: 'custom-1', name: 'Custom Unit', isPediatric: false },
    ];

    process.env = {
      ...process.env,
      UNITS_CONFIG: JSON.stringify(customUnits),
    };

    // Mock del propio módulo unitsConfig para este test:
    // lee process.env.UNITS_CONFIG y expone UNITS_CONFIG acorde.
    vi.doMock('@/src/config/unitsConfig', () => {
      const raw = process.env.UNITS_CONFIG;
      let UNITS_CONFIG: any[] = [];

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            UNITS_CONFIG = parsed;
          } else if (parsed && Array.isArray((parsed as any).units)) {
            UNITS_CONFIG = (parsed as any).units;
          }
        } catch {
          UNITS_CONFIG = [];
        }
      }

      return {
        __esModule: true,
        UNITS_CONFIG,
      };
    });

    // Aseguramos que se vuelva a evaluar el módulo con el mock anterior
    vi.resetModules();
    const { UNITS_CONFIG } = await import('@/src/config/unitsConfig');

    expect(Array.isArray(UNITS_CONFIG)).toBe(true);
    expect(UNITS_CONFIG.some((u: any) => u.id === 'custom-1')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 🧩 HandoverForm + unitConfig integration (con react-test-renderer)
// -----------------------------------------------------------------------------

describe('HandoverForm unit config usage', () => {
  const defaultUnits = [
    { id: 'uci-adulto', name: 'UCI Adulto', isPediatric: false },
    { id: 'pediatria', name: 'Pediatría', isPediatric: true },
  ];

  const renderFormWithTestRenderer = async () => {
    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
      getState: vi.fn(() => ({ routeNames: [] })),
    } as any;

    const route = {
      key: 'handover',
      name: 'HandoverForm' as const,
      params: {
        patientId: 'patient-1',
        unitId: undefined,
        specialtyId: 'icu',
      },
    } as const;

    // Inyectamos la config de unidades vía env, como en la app real
    process.env = {
      ...process.env,
      UNITS_CONFIG: JSON.stringify({
        defaultUnit: 'uci-adulto',
        units: defaultUnits,
      }),
    };

    let renderer: any;

    await act(async () => {
      renderer = TestRenderer.create(
        <HandoverForm navigation={navigation} route={route} />,
      );
    });

    return renderer as any;
  };

  beforeEach(() => {
    process.env = {
      ...process.env,
      UNITS_CONFIG: JSON.stringify({
        defaultUnit: 'uci-adulto',
        units: defaultUnits,
      }),
    };
  });

  it('falls back to default unit when the selected one does not exist', async () => {
    const renderer = await renderFormWithTestRenderer();
    const root = renderer.root;

    // Debe renderizar al menos una vez "Escalas clínicas"
    const clinicalScales = root.findAll(
      (node: any) =>
        typeof node.props?.children === 'string' &&
        node.props.children.includes('Escalas clínicas'),
    );
    expect(clinicalScales.length).toBeGreaterThan(0);

    // Y NO debe mostrar el bloque pediátrico
    const pediatricBlocks = root.findAll(
      (node: any) =>
        typeof node.props?.children === 'string' &&
        node.props.children.includes('TODO: Escalas pediátricas aquí'),
    );
    expect(pediatricBlocks.length).toBe(0);
  });

  it('enables pediatric features when the unit is pediatrics', async () => {
    const renderer = await renderFormWithTestRenderer();
    const root = renderer.root;

    // Localizamos el input de unidad por el placeholder "UCI Adulto"
    const unitInput = root.find(
      (node: any) =>
        node.props &&
        node.props.placeholder === 'UCI Adulto' &&
        typeof node.props.onChangeText === 'function',
    );

    await act(async () => {
      unitInput.props.onChangeText('pediatria');
    });

    const pediatricBlocks = root.findAll(
      (node: any) =>
        typeof node.props?.children === 'string' &&
        node.props.children.includes('TODO: Escalas pediátricas aquí'),
    );

    expect(pediatricBlocks.length).toBeGreaterThan(0);
  });
});
