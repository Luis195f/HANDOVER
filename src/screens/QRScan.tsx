// src/screens/QRScan.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/src/navigation/types';
import { usePatientSummary } from '@/src/hooks/usePatientSummary';
import { prefillFromFHIR, type PrefillOutput } from '@/src/lib/prefill';
import { ensureFreshAccessToken, useAuth } from '@/src/security/auth';
import { PatientBanner } from './components/PatientBanner';
import { getUserFacingNetworkMessage, normalizeNetError } from '@/src/lib/net-errors';
import { t } from '@/src/i18n';
import { useThemeTokens } from '@/src/theme';

// Ajusta este nombre de ruta si en tu RootNavigator usas otro (por ejemplo "QRScan")
type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

type ParsedQRCode = {
  patientId: string;
  server?: string;
  unit?: string;
  bed?: string;
  visitId?: string;
  raw: string;
};

const PATIENT_URL_REGEX = /(?:Patient|patient)\/([^/?#]+)/;

function normalizePatientId(id?: string | null): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  const segments = trimmed.split('/').filter(Boolean);
  if (!segments.length) return null;
  const terminal = segments[segments.length - 1].trim();
  return terminal || null;
}

function parseJsonPayload(payload: string): ParsedQRCode | null {
  if (!payload.trim().startsWith('{') || !payload.trim().endsWith('}')) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed.patientId !== 'string' || !parsed.patientId.trim()) {
      return null;
    }
    const normalizeOptional = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;

    return {
      patientId: parsed.patientId.trim(),
      server: normalizeOptional(parsed.server),
      unit: normalizeOptional(parsed.unit),
      bed: normalizeOptional(parsed.bed),
      visitId: normalizeOptional(parsed.visitId),
      raw: payload,
    };
  } catch {
    return null;
  }
}

function parseUrlPayload(payload: string): ParsedQRCode | null {
  const match = PATIENT_URL_REGEX.exec(payload);
  if (!match?.[1]) return null;
  const patientId = decodeURIComponent(match[1]);
  try {
    const url = new URL(payload);
    const isHttp = url.protocol.startsWith('http');
    const basePath = url.pathname.replace(/\/?Patient\/.+$/, '');
    const server = isHttp ? `${url.origin}${basePath}`.replace(/\/$/, '') : undefined;
    return { patientId, server, raw: payload };
  } catch {
    return { patientId, raw: payload };
  }
}

function parseQRCodePayload(payload: string): ParsedQRCode | null {
  const trimmed = payload.trim();
  const fromJson = parseJsonPayload(trimmed);
  if (fromJson) return fromJson;
  const fromUrl = parseUrlPayload(trimmed);
  if (fromUrl) return fromUrl;
  if (trimmed.length > 0) {
    return { patientId: trimmed, raw: trimmed };
  }
  return null;
}

export function QRScanScreen({ navigation, route }: Props) {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [parsedPayload, setParsedPayload] = useState<ParsedQRCode | null>(null);
  const [patientMismatch, setPatientMismatch] = useState<
    { currentId: string; scannedId: string } | null
  >(null);
  const [prefilledValues, setPrefilledValues] = useState<PrefillOutput | null>(null);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const currentPatientId = route.params?.patientIdParam?.trim();
  const targetPatientId = patientMismatch ? undefined : parsedPayload?.patientId;
  const { loading, error, summary } = usePatientSummary(targetPatientId || undefined);
  const { session } = useAuth();
  const { colors } = useThemeTokens();
  const permissionAlertedRef = useRef(false);

  const { returnTo, unitIdParam, specialtyId } = route.params ?? {};
  const clearTransientStates = useCallback(() => {
    setPrefillError(null);
    setPrefillLoading(false);
    setPatientMismatch(null);
  }, []);

  // Pedir permisos de cámara al entrar
  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!permission || permission.granted || permissionAlertedRef.current) return;
    permissionAlertedRef.current = true;
    console.warn('[HNDV][WARN][PERM_CAM_DENIED]', { screen: 'QRScan' });
    Alert.alert(
      t('permissions.cameraDeniedTitle'),
      t('permissions.cameraDeniedQrMessage'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => navigation.goBack(),
        },
        {
          text: t('common.openSettings'),
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ],
    );
  }, [navigation, permission]);

  // Al salir de la pantalla, reseteamos el estado de escaneo
  useEffect(() => {
    if (!isFocused && scanned) {
      setScanned(false);
      setParsedPayload(null);
      setPrefilledValues(null);
      setPrefillError(null);
      setPatientMismatch(null);
    }
  }, [isFocused, scanned]);

  useEffect(() => {
    if (!parsedPayload?.patientId) return;
    let cancelled = false;
    const fhirBase = parsedPayload.server
      ?? process.env.EXPO_PUBLIC_FHIR_BASE_URL
      ?? process.env.FHIR_BASE_URL;

    const loadPrefill = async () => {
      setPrefillLoading(true);
      setPrefillError(null);
      try {
        const freshToken = await ensureFreshAccessToken();
        const values = await prefillFromFHIR(parsedPayload.patientId, {
          fhirBase,
          token: freshToken ?? session?.accessToken,
        });
        if (!cancelled) {
          setPrefilledValues(values);
        }
      } catch (err: any) {
        if (!cancelled) {
          const netError = normalizeNetError(err);
          const ui = getUserFacingNetworkMessage(netError, { screen: 'QRScan', op: 'prefill' });
          setPrefillError(ui.message);
        }
      } finally {
        if (!cancelled) {
          setPrefillLoading(false);
        }
      }
    };

    loadPrefill();
    return () => {
      cancelled = true;
    };
  }, [parsedPayload, patientMismatch, session?.accessToken]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanned) return; // evita doble disparo

      clearTransientStates();
      setScanned(true);

      const data = result.data?.trim();
      if (!data) {
        Alert.alert(t('qr.invalidCodeTitle'), t('qr.invalidCodeMessage'));
        setScanned(false);
        return;
      }

      const parsed = parseQRCodePayload(data);
      if (!parsed) {
        Alert.alert(t('qr.invalidDataTitle'), t('qr.invalidDataMessage'));
        setScanned(false);
        return;
      }

      setParsedPayload(parsed);
      const normalizedCurrentId = normalizePatientId(currentPatientId);
      const normalizedScannedId = normalizePatientId(parsed.patientId);
      if (
        normalizedCurrentId
        && normalizedScannedId
        && normalizedCurrentId !== normalizedScannedId
      ) {
        setPatientMismatch({ currentId: currentPatientId ?? '', scannedId: parsed.patientId });
        return;
      }
      setPatientMismatch(null);
    },
    [clearTransientStates, currentPatientId, scanned],
  );

  const handleContinue = () => {
    if (!parsedPayload?.patientId || patientMismatch) return;
    const targetRoute = returnTo ?? 'HandoverForm';
    const params =
      targetRoute === 'HandoverForm'
        ? {
            patientId: parsedPayload.patientId,
            unitId: parsedPayload.unit ?? unitIdParam,
            specialtyId,
            prefilledValues,
            patientSummary: summary,
            prefillMeta: {
              server: parsedPayload.server,
              unit: parsedPayload.unit ?? unitIdParam,
              bed: parsedPayload.bed,
              visitId: parsedPayload.visitId,
            },
        }
        : { patientId: parsedPayload.patientId };
    clearTransientStates();
    (navigation as any).navigate(targetRoute, params);
  };

  const handleRescan = () => {
    setScanned(false);
    setParsedPayload(null);
    setPrefilledValues(null);
    setPrefillError(null);
    setPatientMismatch(null);
    setPrefillLoading(false);
  };

  const handleKeepCurrentPatient = () => {
    setPatientMismatch(null);
    setParsedPayload(null);
    setPrefilledValues(null);
    setPrefillError(null);
    setPrefillLoading(false);
    setScanned(false);
  };

  const handleSwitchToScannedPatient = () => {
    if (!parsedPayload?.patientId) return;
    clearTransientStates();
  };

  const handleRetryPrefill = () => {
    if (!parsedPayload) return;
    setPrefillError(null);
    setPrefilledValues(null);
    setPrefillLoading(false);
    setParsedPayload({ ...parsedPayload });
  };

  const continueDisabled = useMemo(
    () => !parsedPayload?.patientId || !!patientMismatch,
    [parsedPayload?.patientId, patientMismatch],
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.text}>{t('qr.requestingCameraPermission')}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.text}>{t('qr.checkingCameraPermission')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Sólo montamos la cámara cuando la pantalla está enfocada */}
      {isFocused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        />
      )}

      {/* Overlay con instrucciones */}
      <View style={styles.overlay}>
        {parsedPayload ? (
          <>
            <PatientBanner summary={summary} loading={loading} error={error} />
            {patientMismatch ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>{t('qr.mismatchTitle')}</Text>
                <Text style={styles.warningText}>
                  {t('qr.mismatchSelectedLabel', { id: patientMismatch.currentId || t('common.notAvailable') })}
                </Text>
                <Text style={styles.warningText}>
                  {t('qr.mismatchQrLabel', { id: patientMismatch.scannedId })}
                </Text>
                <View style={styles.warningActions}>
                  <Pressable accessibilityRole="button" onPress={handleKeepCurrentPatient}>
                    <Text style={styles.link} onPress={handleKeepCurrentPatient}>
                      {t('qr.keepCurrentPatient')}
                    </Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={handleSwitchToScannedPatient}>
                    <Text style={styles.link} onPress={handleSwitchToScannedPatient}>
                      {t('qr.switchToScannedPatient')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {prefillLoading ? (
              <View style={styles.inlineStatus}>
                <ActivityIndicator color="#BFDBFE" />
                <Text style={styles.statusText}>{t('qr.prefillLoading')}</Text>
              </View>
            ) : null}
            {prefillError ? (
              <Text style={[styles.errorText, { color: colors.danger }]}>{prefillError}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={handleContinue}
              style={[styles.primaryButton, continueDisabled && styles.primaryButtonDisabled]}
              disabled={continueDisabled}
            >
              <Text style={styles.primaryButtonText} onPress={handleContinue}>
                {t('qr.continueHandover')}
              </Text>
            </Pressable>
            {prefillError ? (
              <Pressable accessibilityRole="button" onPress={handleRetryPrefill}>
                <Text style={styles.link} onPress={handleRetryPrefill}>{t('qr.retryPrefill')}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={handleRescan}>
              <Text style={styles.link} onPress={handleRescan}>
                {t('qr.rescan')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>{t('qr.scanPromptTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('qr.scanPromptSubtitle')}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

export default QRScanScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    fontSize: 16,
    textAlign: 'center',
    color: '#111111',
  },
  link: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
    textDecorationLine: 'underline',
    color: '#007AFF',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  primaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2563EB',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  statusText: {
    color: '#E5E7EB',
    fontSize: 14,
  },
  errorText: {
    marginTop: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#E5E5E5',
  },
  warningBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
  },
  warningTitle: {
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  warningText: {
    color: '#78350F',
    fontSize: 14,
  },
  warningActions: {
    marginTop: 8,
    gap: 4,
  },
});
