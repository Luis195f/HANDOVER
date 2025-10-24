// FILE: src/components/AppFrame.tsx
// @ts-nocheck
import React from 'react';
import { SafeAreaView, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import OfflineBanner from '@/src/components/OfflineBanner';

type Props = { children: React.ReactNode };

export default function AppFrame({ children }: Props) {
  const nav = useNavigation();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <OfflineBanner onPress={() => nav.navigate('SyncCenter' as never)} />
        <View style={styles.content}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1 },
  content: { flex: 1 },
});
