declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }

  interface Process {
    env: ProcessEnv;
  }
}

declare const process: NodeJS.Process;
declare function require(moduleName: string): any;
declare const module: any;
declare const __dirname: string;
declare const __filename: string;
declare var global: any;
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(handle?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(handle?: number): void;

interface Headers {
  get(name: string): string | null;
}

type RequestInfo = string;

interface Response {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  json(): Promise<any>;
  text(): Promise<string>;
  clone(): Response;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

declare function fetch(input: string, init?: RequestInit): Promise<Response>;

declare class AbortController {
  readonly signal: any;
  abort(): void;
}

declare module '*';

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module 'react' {
  export type ReactNode = any;
  export type PropsWithChildren<P = unknown> = P & { children?: ReactNode };
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type EffectCallback = () => void | (() => void);
  export type DependencyList = ReadonlyArray<unknown>;
  export type ComponentType<P = any> = (props: P) => JSX.Element | null;
  export type FC<P = {}> = ComponentType<PropsWithChildren<P>>;
  export type MutableRefObject<T> = { current: T };

  export function useState<S>(initialState: S): [S, (value: SetStateAction<S>) => void];
  export function useEffect(effect: EffectCallback, deps?: DependencyList): void;
  export function useLayoutEffect(effect: EffectCallback, deps?: DependencyList): void;
  export function useMemo<T>(factory: () => T, deps: DependencyList): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: DependencyList): T;
  export function useRef<T>(initialValue: T): MutableRefObject<T>;
  export function useContext<T>(context: Context<T>): T;
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useReducer<R extends (state: any, action: any) => any, I>(
    reducer: R,
    initialArg: I,
    init?: (arg: I) => ReturnType<R>
  ): [ReturnType<R>, Dispatch<Parameters<R>[1]>];
  export function useId(): string;

  export interface Context<T> {
    Provider: FC<{ value: T }>;
    Consumer: FC<{ children: (value: T) => ReactNode }>;
  }

  export const Fragment: unique symbol;
  export const Children: any;
  export function createElement(type: any, props?: any, ...children: ReactNode[]): any;

  const React: {
    createElement: typeof createElement;
    Fragment: typeof Fragment;
    useState: typeof useState;
    useEffect: typeof useEffect;
    useLayoutEffect: typeof useLayoutEffect;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    useRef: typeof useRef;
    useContext: typeof useContext;
    createContext: typeof createContext;
    useReducer: typeof useReducer;
    useId: typeof useId;
  };

  export default React;
}

declare module 'react-native' {
  import type { ComponentType } from 'react';
  export const View: ComponentType<any>;
  export const Text: ComponentType<any>;
  export const Pressable: ComponentType<any>;
  export const TouchableOpacity: ComponentType<any>;
  export const FlatList: ComponentType<any>;
  export const ScrollView: ComponentType<any>;
  export const TextInput: ComponentType<any>;
  export const ActivityIndicator: ComponentType<any>;
  export const RefreshControl: ComponentType<any>;
  export const StatusBar: ComponentType<any>;
  export const Button: ComponentType<any>;
  export const Switch: ComponentType<any>;
  export const KeyboardAvoidingView: ComponentType<any>;
  export const Keyboard: {
    addListener(event: string, listener: (...args: any[]) => void): { remove(): void };
  };
  export const Platform: { OS: string; select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined };
  export const Alert: {
    alert(title: string, message?: string, buttons?: Array<{ text: string; onPress?: () => void }>): void;
  };
  export function useColorScheme(): 'light' | 'dark' | null;
  export const StyleSheet: { create<T extends Record<string, any>>(styles: T): T };
  export type NativeSyntheticEvent<T> = { nativeEvent: T };
  export type ColorValue = string;
  export interface GestureResponderEvent {}
}

declare module '@react-navigation/native' {
  import type { ComponentType } from 'react';
  export type NavigationState = any;
  export type NavigationContainerRef<T> = {
    isReady(): boolean;
    dispatch(action: any): void;
    canGoBack(): boolean;
    goBack(): void;
    getCurrentRoute(): { name: keyof T; params?: T[keyof T] } | undefined;
  };
  export function createNavigationContainerRef<T>(): NavigationContainerRef<T>;
  export const CommonActions: {
    navigate(payload: { name: string; params?: unknown }): any;
    reset(state: { index: number; routes: Array<{ name: string; params?: unknown }> }): any;
  };
  export const StackActions: {
    push(name: string, params?: unknown): any;
    replace(name: string, params?: unknown): any;
  };
  export type Theme = {
    dark: boolean;
    colors: Record<string, string>;
  };
  export const DefaultTheme: Theme;
  export const DarkTheme: Theme;
  export const NavigationContainer: ComponentType<{ children?: any; ref?: any }>;
  export function useNavigation<T = any>(): T;
  export function useRoute<T = any>(): T;
  export type RouteProp<P, K extends keyof P> = { key: string; name: K; params: P[K] };
}

declare module '@react-navigation/native-stack' {
  import type { ComponentType, ReactNode } from 'react';
  export type NativeStackScreenProps<ParamList, RouteName extends keyof ParamList> = {
    navigation: any;
    route: { key: string; name: RouteName; params: ParamList[RouteName] };
  };
  export function createNativeStackNavigator<ParamList>(): {
    Navigator: ComponentType<{ children: ReactNode }>;
    Screen: ComponentType<{ name: keyof ParamList; component: ComponentType<any>; options?: Record<string, unknown> }>;
  };
}

declare module 'react-hook-form' {
  export type FieldValues = Record<string, unknown>;
  export type DefaultValues<T extends FieldValues> = Partial<T>;
  export type UseFormReturn<T extends FieldValues> = {
    control: any;
    handleSubmit: (...args: any[]) => any;
    setValue: (...args: any[]) => any;
    watch: (...args: any[]) => any;
    getValues: (...args: any[]) => any;
    reset: (...args: any[]) => any;
    formState: { errors: Record<string, unknown>; isSubmitting: boolean };
  };
  export function useForm<T extends FieldValues>(options?: { defaultValues?: DefaultValues<T>; resolver?: any }): UseFormReturn<T>;
  export const Controller: any;
}

declare module '@hookform/resolvers/zod' {
  export const zodResolver: (...args: any[]) => any;
}

declare module 'zod' {
  export const z: any;
  export type ZodTypeAny = any;
  export namespace z {
    type infer<T> = any;
    type output<T> = any;
  }
}

declare module 'crypto-js' {
  export namespace enc {
    const Utf8: { parse(input: string): any };
    const Hex: any;
  }
  export namespace lib {
    class WordArray {
      static create(words?: number[] | Uint8Array, sigBytes?: number): WordArray;
      concat(wordArray: WordArray): WordArray;
    }
  }
  export function SHA256(message: any): { toString(encoder: any): string };
}

declare module 'expo-*' {
  const ExpoModule: any;
  export = ExpoModule;
}

declare module '@react-native-community/*' {
  const Module: any;
  export = Module;
}

declare module 'expo-audio' {
  export const AudioModule: any;
  export const setAudioModeAsync: (...args: any[]) => Promise<void>;
  export function useAudioRecorder(options: any): any;
  export function useAudioRecorderState(recorder: any): any;
}

declare module 'expo-camera' {
  export const CameraView: any;
  export function useCameraPermissions(): [any, () => Promise<any>];
}
