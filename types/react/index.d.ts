export type ReactNode = any;
export interface FC<P = {}> {
  (props: P & { children?: ReactNode }): ReactNode;
}
export function useState<T>(initial: T): [T, (value: T) => void];
export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
export function useMemo<T>(factory: () => T, deps: any[]): T;
export function useRef<T>(initial: T): { current: T };
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
export function useContext<T>(ctx: any): T;
export function useLayoutEffect(effect: () => void | (() => void), deps?: any[]): void;
export interface Context<T> {
  Provider: FC<{ value: T }>;
  Consumer: FC<{ value: T }>;
}
export function createContext<T>(value: T): Context<T>;
export const Fragment: unique symbol;
const React: {
  useState: typeof useState;
  useEffect: typeof useEffect;
  useMemo: typeof useMemo;
  useRef: typeof useRef;
  useCallback: typeof useCallback;
  useContext: typeof useContext;
  useLayoutEffect: typeof useLayoutEffect;
  createContext: typeof createContext;
};
export default React;
export type ReactElement = any;
