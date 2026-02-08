import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/src/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'HandoverMain'>;

export default function HandoverMain({ navigation, route }: Props) {
  useEffect(() => {
    navigation.replace('HandoverForm', route.params);
  }, [navigation, route.params]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
