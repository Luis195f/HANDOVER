// tests/__mocks__/@react-navigation-native.ts
// Mock muy simple de React Navigation para entorno de pruebas (Node/Vitest).

export type ParamListBase = Record<string, object | undefined>;

export type NavigationContainerRef<
  T extends ParamListBase = ParamListBase,
> = {
  navigate: (name: keyof T & string, params?: T[keyof T]) => void;
  goBack: () => void;
  reset: (...args: any[]) => void;
};

export function createNavigationContainerRef<
  T extends ParamListBase = ParamListBase,
>(): NavigationContainerRef<T> {
  return {
    navigate: () => {},
    goBack: () => {},
    reset: () => {},
  };
}

// Componente de alto nivel → en tests sólo devuelve los children
export const NavigationContainer = (props: any) => {
  return props.children;
};

export function useNavigation() {
  return {
    navigate: () => {},
    goBack: () => {},
    reset: () => {},
  };
}

export function useRoute() {
  return {
    params: {},
  } as any;
}

export const useFocusEffect = (_cb: any) => {
  // no-op
};

export const StackActions = {
  replace: (..._args: any[]) => ({ type: 'REPLACE' }),
};
