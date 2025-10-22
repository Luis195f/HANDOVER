// FILE: src/components/OfflineBanner.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import NetInfo, { useNetInfo } from '@/src/lib/netinfo';
import { getQueueSize } from '@/src/lib/sync';

type Props = { onPress?: () => void };

const DEBOUNCE_MS = 800;

export default function OfflineBanner({ onPress }: Props) {
  const scheme = useColorScheme();
  const C = scheme === 'dark' ? D_COLORS : L_COLORS;

  const netInfo = useNetInfo();
  const [count, setCount] = React.useState<number>(0);

  const lastTapRef = React.useRef<number>(0);
  const [cooldown, setCooldown] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = React.useCallback(async () => {
    const n = await getQueueSize();
    setCount(n < 0 ? 0 : n);
  }, []);

  React.useEffect(() => {
    const sub = NetInfo.addEventListener(() => refresh());
    refresh();
    return () => sub();
  }, [refresh]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handlePress = React.useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DEBOUNCE_MS) return; // debounce
    lastTapRef.current = now;

    // efecto visual de cooldown (sin cambiar API)
    setCooldown(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCooldown(false), DEBOUNCE_MS);

    onPress?.();
  }, [onPress]);

  const offline = !(netInfo.isConnected && (netInfo.isInternetReachable ?? true));
  const show = offline || count > 0;
  if (!show) return null;

  const text = offline
    ? `Sin conexión · ${count} en cola`
    : `${count} en cola · toca para ver`;

  return (
    <Pressable onPress={handlePress} style={[styles.wrap, { backgroundColor: C.bg }]}>
      <View
        style={[
          styles.banner,
          { backgroundColor: offline ? C.offline : C.queue, opacity: cooldown ? 0.85 : 1 },
        ]}
        pointerEvents={cooldown ? 'none' : 'auto'}
      >
        <Text style={[styles.text, { color: C.text }]}>{text}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  banner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontWeight: '600' },
});

const L_COLORS = {
  bg: '#ffffff',
  offline: '#B00020', // error
  queue: '#FF8F00',   // warning
  text: '#ffffff',
};

const D_COLORS = {
  bg: '#121212',
  offline: '#CF6679',
  queue: '#FFB300',
  text: '#000000',
};
