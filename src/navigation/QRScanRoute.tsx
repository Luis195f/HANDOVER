import React, { Suspense } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { getPatientIdentificationHint, isQrPatientScanEnabled } from '@/src/config/patientIdentification';
import type { RootStackParamList } from '@/src/navigation/types';

const LazyQRScanScreen = React.lazy(() => import('@/src/screens/QRScan'));

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

export default function QRScanRoute(props: Props) {
  const { unitIdParam, specialtyId } = props.route.params ?? {};
  const qrEnabled = isQrPatientScanEnabled({ unitId: unitIdParam, specialtyId });

  if (!qrEnabled) {
    return (
      <View testID="qr-scan-disabled" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center' }}>
          {getPatientIdentificationHint({ unitId: unitIdParam, specialtyId })}
        </Text>
      </View>
    );
  }

  return (
    <Suspense
      fallback={
        <View testID="qr-scan-loading" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      }
    >
      <LazyQRScanScreen {...props} />
    </Suspense>
  );
}
