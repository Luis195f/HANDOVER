// FILE: src/components/AppFrame.tsx
import React from 'react';
import { SafeAreaView, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import OfflineBanner from '@/src/components/OfflineBanner';
import type { RootStackParamList } from '@/src/navigation/types';

type Props = { children: React.ReactNode };

export default function AppFrame({ children }: Props) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <OfflineBanner onPress={() => nav.navigate('SyncCenter')} />
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
