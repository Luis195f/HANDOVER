// FILE: src/lib/netinfo.ts
import * as React from 'react';

export type NetInfoState = { isConnected: boolean | null; isInternetReachable: boolean | null };
type NetInfoListener = (state: NetInfoState) => void;

type NetInfoModule = {
  addEventListener: (cb: NetInfoListener) => { remove(): void } | (() => void);
  fetch: () => Promise<NetInfoState>;
};

type NetworkModule = {
  addNetworkStateListener: (cb: NetInfoListener) => { remove(): void };
  getNetworkStateAsync: () => Promise<NetInfoState>;
};

let NetInfo: NetInfoModule | null = null;
let useNetInfo: (() => NetInfoState) | null = null;

try {
  // Intenta usar @react-native-community/netinfo si existe
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-community/netinfo') as {
    default?: NetInfoModule;
    useNetInfo?: () => NetInfoState;
  };
  NetInfo = mod?.default ?? null;
  useNetInfo = mod?.useNetInfo ?? null;
} catch {
  // Fallback: expo-network si está disponible. Si tampoco lo está, usar stub síncrono.
  let Network: NetworkModule | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Network = require('expo-network') as NetworkModule;
  } catch {
    Network = null;
  }

  if (!Network) {
    NetInfo = {
      addEventListener(cb: NetInfoListener) {
        const emit = () => cb({ isConnected: true, isInternetReachable: true });
        if (typeof queueMicrotask === 'function') {
          queueMicrotask(emit);
        } else {
          setTimeout(emit, 0);
        }
        return () => {};
      },
      async fetch() {
        return { isConnected: true, isInternetReachable: true };
      },
    };
    useNetInfo = function useNetInfoStub() {
      return { isConnected: true, isInternetReachable: true };
    };
  } else {
    NetInfo = {
      addEventListener(cb: NetInfoListener) {
        const sub = Network!.addNetworkStateListener((state) =>
          cb({
            isConnected: !!state?.isConnected,
            isInternetReachable: state?.isInternetReachable ?? null,
          })
        );
        return () => sub.remove();
      },
      async fetch() {
        const s = await Network!.getNetworkStateAsync();
        return {
          isConnected: !!s?.isConnected,
          isInternetReachable: s?.isInternetReachable ?? null,
        };
      },
    };

    // Hook compatible con useNetInfo()
    useNetInfo = function useNetInfoPolyfill() {
      const [state, setState] = React.useState<NetInfoState>({
        isConnected: null,
        isInternetReachable: null,
      });

      React.useEffect(() => {
        let mounted = true;
        // snapshot inicial
        Network!.getNetworkStateAsync().then((s) => {
          if (!mounted) return;
          setState({ isConnected: !!s?.isConnected, isInternetReachable: s?.isInternetReachable ?? null });
        });
        const sub = Network!.addNetworkStateListener((s) => {
          if (!mounted) return;
          setState({ isConnected: !!s?.isConnected, isInternetReachable: s?.isInternetReachable ?? null });
        });
        return () => {
          mounted = false;
          sub.remove();
        };
      }, []);

      return state;
    };
  }
}

export default NetInfo as NetInfoModule;
export { useNetInfo };
