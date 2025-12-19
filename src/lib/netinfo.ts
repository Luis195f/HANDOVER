// FILE: src/lib/netinfo.ts
import * as React from 'react';

export type NetInfoState = { isConnected: boolean | null; isInternetReachable: boolean | null };
type NetInfoListener = (state: NetInfoState) => void;

type NetInfoSubscription = { remove(): void } | (() => void) | void;
type NetInfoModuleLike = {
  addEventListener: (cb: NetInfoListener) => NetInfoSubscription;
  fetch: () => Promise<NetInfoState>;
};
type NetInfoModule = {
  addEventListener: (cb: NetInfoListener) => () => void;
  fetch: () => Promise<NetInfoState>;
};

type NetworkModule = {
  addNetworkStateListener: (cb: NetInfoListener) => { remove(): void };
  getNetworkStateAsync: () => Promise<NetInfoState>;
};

let NetInfo: NetInfoModule | null = null;
let netInfoHook: (() => NetInfoState) | null = null;

const normalizeSubscription = (subscription: NetInfoSubscription): (() => void) => {
  if (typeof subscription === 'function') return subscription;
  if (subscription && typeof subscription === 'object' && typeof subscription.remove === 'function') {
    return () => subscription.remove();
  }
  return () => {};
};

const fallbackState: NetInfoState = { isConnected: null, isInternetReachable: null };

try {
  // Intenta usar @react-native-community/netinfo si existe
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-community/netinfo') as {
    default?: NetInfoModuleLike;
    useNetInfo?: () => NetInfoState;
  };
  NetInfo = mod?.default
    ? {
        ...mod.default,
        addEventListener(cb: NetInfoListener) {
          return normalizeSubscription(mod.default!.addEventListener(cb));
        },
      }
    : null;
  netInfoHook = mod?.useNetInfo ?? null;
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
    netInfoHook = function useNetInfoStub() {
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
    netInfoHook = function useNetInfoPolyfill() {
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

const resolvedNetInfo: NetInfoModule = NetInfo ?? {
  addEventListener: (cb: NetInfoListener) => {
    cb(fallbackState);
    return () => {};
  },
  async fetch() {
    return fallbackState;
  },
};

export default resolvedNetInfo;
export function useNetInfo(): NetInfoState {
  return (netInfoHook ?? (() => fallbackState))();
}
