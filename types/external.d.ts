declare module 'react' {
  export type ReactNode = any;
  export type ReactElement = any;
  export interface FC<P = {}> {
    (props: P & { children?: ReactNode }): ReactElement | null;
  }
  export function useState<T = any>(initial: T): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useMemo<T>(factory: () => T, deps: any[]): T;
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
  export function useContext<T = any>(ctx: any): T;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function createContext<T>(value: T): { Provider: FC<{ value: T }>; Consumer: FC<{ value: T }> };
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
}

declare namespace React {
  type ReactNode = any;
  type ReactElement = any;
  interface FC<P = {}> {
    (props: P & { children?: ReactNode }): ReactElement | null;
  }
}

declare module 'react-native' {
  export const View: any;
  export const Text: any;
  export const StatusBar: any;
  export const Pressable: any;
  export const SafeAreaView: any;
  export const FlatList: any;
  export const ScrollView: any;
  export const TextInput: any;
  export const ActivityIndicator: any;
  export const RefreshControl: any;
  export const Alert: any;
  export const Switch: any;
  export const StyleSheet: any;
  export const SafeAreaView: any;
  export const Platform: { OS: string };
  export type ColorSchemeName = 'light' | 'dark' | null;
  export function useColorScheme(): ColorSchemeName;
  export type ViewStyle = any;
  export type TextStyle = any;
}

declare module 'react-native-gesture-handler' {}

declare module '@react-navigation/native' {
  export type NavigationAction = any;
  export interface NavigationRef<T extends Record<string, any> = Record<string, any>> {
    isReady(): boolean;
    dispatch(action: NavigationAction): void;
    canGoBack(): boolean;
    goBack(): void;
    getCurrentRoute(): { name: keyof T; params?: T[keyof T] } | undefined;
    navigate(name: keyof T, params?: T[keyof T]): void;
  }
  export type NavigationContainerRef<T extends Record<string, any> = Record<string, any>> = NavigationRef<T>;
  export function createNavigationContainerRef<T extends Record<string, any> = Record<string, any>>(): NavigationContainerRef<T>;
  export const CommonActions: { navigate(payload: { name: string; params?: any }): NavigationAction; reset(state: any): NavigationAction };
  export const StackActions: { push(name: string, params?: any): NavigationAction; replace(name: string, params?: any): NavigationAction };
  export const NavigationContainer: React.FC<{ ref?: any; children?: React.ReactNode }>;
  export function useNavigation<T = any>(): T;
  export function useFocusEffect(effect: () => void): void;
}

declare module '@react-navigation/native-stack' {
  export interface NativeStackNavigator<T extends Record<string, any>> {
    Navigator: React.FC<{ children?: React.ReactNode }>;
    Screen: React.FC<{ name: keyof T; component: React.ComponentType<any>; options?: Record<string, any> }>;
  }
  export function createNativeStackNavigator<T extends Record<string, any>>(): NativeStackNavigator<T> & { Screen: any; Navigator: any };
}

declare module 'crypto-js' {
  export namespace enc {
    const Utf8: { parse(value: string): any };
    const Hex: { stringify(value: any): string };
  }
  export namespace lib {
    const WordArray: { create(value?: Uint8Array | number[]): any };
  }
  export namespace algo {
    const SHA256: { create(): { update(chunk: any): void; finalize(): any } };
  }
  const CryptoJS: any;
  export default CryptoJS;
}

declare module '@/src/screens/PatientList' {
  const Component: React.FC<any>;
  export default Component;
}

declare module '@/src/screens/HandoverForm' {
  const Component: React.FC<any>;
  export default Component;
}

declare module '@/src/screens/SyncCenter' {
  const Component: React.FC<any>;
  export default Component;
}

declare module '@/src/navigation/navigation' {
  export const navigationRef: any;
}

declare module 'react-native-safe-area-context' {
  export const SafeAreaProvider: React.FC<{ children?: React.ReactNode }>;
  export const SafeAreaView: any;
  export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number };
}

declare module 'react-native-screens' {
  export const enableScreens: (shouldEnable?: boolean) => void;
}

declare module '@react-native-community/netinfo' {
  export type NetInfoState = { isConnected: boolean | null; isInternetReachable: boolean | null };
  export function fetch(): Promise<NetInfoState>;
  export function addEventListener(listener: (state: NetInfoState) => void): { remove(): void };
}

declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export default AsyncStorage;
}

declare module 'expo-crypto' {
  export enum CryptoDigestAlgorithm {
    SHA256 = 'SHA256'
  }
  export function digestStringAsync(algo: CryptoDigestAlgorithm, data: string): Promise<string>;
}

declare module 'expo-secure-store' {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}

declare module 'expo-file-system' {
  export type FileInfo = { exists: boolean };
  export function getInfoAsync(uri: string): Promise<FileInfo>;
  export function readAsStringAsync(uri: string, options?: { encoding?: string }): Promise<string>;
}

declare module 'expo-audio' {
  export type RecordingOptions = any;
  export const AudioModule: { requestRecordingPermissionsAsync(): Promise<{ granted: boolean }> };
  export function useAudioRecorder(options: RecordingOptions): any;
  export function useAudioRecorderState(recorder: any): any;
  export function setAudioModeAsync(config: any): Promise<void>;
}

declare module 'expo-camera' {
  export const Camera: any;
  export type CameraType = any;
}

declare module 'expo-network' {
  export function getNetworkStateAsync(): Promise<{ isConnected: boolean; isInternetReachable: boolean }>;
}

declare module 'expo-notifications' {
  export const Notifications: any;
}

declare module 'expo-speech' {
  export function speak(text: string, options?: any): void;
}

declare module 'expo-sqlite' {
  export function openDatabase(name: string): any;
}

declare module 'expo-status-bar' {
  export const StatusBar: React.FC<any>;
}

declare module 'react-native-svg' {
  const Svg: any;
  export default Svg;
}

declare module 'uuid' {
  export function v4(): string;
}

declare module 'react-test-renderer' {
  export type ReactTestRendererJSON = any;
  export type ReactTestRenderer = { toJSON(): ReactTestRendererJSON | ReactTestRendererJSON[] | null };
  export const act: (cb: () => void | Promise<void>) => Promise<void>;
  export function create(element: any): ReactTestRenderer;
}

declare module '@hookform/resolvers/zod' {
  export function zodResolver(schema: any): (values: any) => Promise<any>;
}

declare module 'react-hook-form' {
  export type FieldValues = Record<string, any>;
  export type DefaultValues<T> = Partial<T>;
  export type UseFormReturn<T> = {
    handleSubmit: (...args: any[]) => any;
    control: any;
    setValue: (...args: any[]) => void;
    watch: (...args: any[]) => any;
    getValues: (...args: any[]) => any;
    reset: (...args: any[]) => void;
    formState: any;
  };
  export function useForm<T extends FieldValues = FieldValues>(options: any): UseFormReturn<T>;
}

declare module '@expo/cli';

declare module 'expo-router';

declare module 'expo-speech';
