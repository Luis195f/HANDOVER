// FILE: src/lib/netinfo.ts
import * as React from 'react';

let NetInfo: any = null;
let useNetInfo: any = null;

try {
  // Intenta usar @react-native-community/netinfo si existe
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-community/netinfo');
  NetInfo = mod?.default ?? mod;
  useNetInfo = mod?.useNetInfo;
} catch {
  // Fallback: expo-network
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Network = require('expo-network');

  NetInfo = {
    addEventListener(cb: (s: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) {
      const sub = Network.addNetworkStateListener((state: any) =>
        cb({
          isConnected: !!state?.isConnected,
          isInternetReachable: state?.isInternetReachable ?? null,
        })
      );
      return () => sub.remove();
    },
    async fetch() {
      const s = await Network.getNetworkStateAsync();
      return {
        isConnected: !!s?.isConnected,
        isInternetReachable: s?.isInternetReachable ?? null,
      };
    },
  };

  // Hook compatible con useNetInfo()
  useNetInfo = function useNetInfoPolyfill() {
    const [state, setState] = React.useState<{ isConnected: boolean | null; isInternetReachable: boolean | null }>({
      isConnected: null,
      isInternetReachable: null,
    });

    React.useEffect(() => {
      let mounted = true;
      // snapshot inicial
      Network.getNetworkStateAsync().then((s: any) => {
        if (!mounted) return;
        setState({ isConnected: !!s?.isConnected, isInternetReachable: s?.isInternetReachable ?? null });
      });
      const sub = Network.addNetworkStateListener((s: any) => {
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

export default NetInfo;
export { useNetInfo };
