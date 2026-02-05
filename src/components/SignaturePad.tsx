import React, { useMemo, useRef, useState } from 'react';
import { Button, PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { t } from '@/src/i18n';

export type SignaturePadValue = {
  imageBase64: string;
  signedAt: string;
};

type SvgRef = React.ElementRef<typeof Svg> & {
  toDataURL?: (callback: (data: string) => void) => void;
};

type SignaturePadProps = {
  value?: SignaturePadValue | null;
  onChange: (value: SignaturePadValue | null) => void;
  disabled?: boolean;
};

// Nota regulatoria: firma local no cualificada (no eIDAS). Aporta trazabilidad MDR/IEC 62304
// al vincular usuario, unidad y fecha/hora en el flujo de entrega.
export function SignaturePad({ value, onChange, disabled }: SignaturePadProps) {
  const svgRef = useRef<SvgRef | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const currentPathRef = useRef<string | null>(null);

  const hasSignature = paths.length > 0 || Boolean(currentPath) || Boolean(value?.imageBase64);

  const handleClear = () => {
    currentPathRef.current = null;
    setCurrentPath(null);
    setPaths([]);
    onChange(null);
  };

  const handleSave = () => {
    if (disabled || !hasSignature) return;
    const signedAt = new Date().toISOString();
    const svgNode = svgRef.current;
    if (!svgNode?.toDataURL) return;
    svgNode.toDataURL((data) => {
      onChange({ imageBase64: data, signedAt });
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (event) => {
          if (disabled) return;
          const { locationX, locationY } = event.nativeEvent;
          const path = `M ${locationX} ${locationY}`;
          currentPathRef.current = path;
          setCurrentPath(path);
        },
        onPanResponderMove: (event) => {
          if (disabled || !currentPathRef.current) return;
          const { locationX, locationY } = event.nativeEvent;
          const next = `${currentPathRef.current} L ${locationX} ${locationY}`;
          currentPathRef.current = next;
          setCurrentPath(next);
        },
        onPanResponderRelease: () => {
          if (disabled || !currentPathRef.current) return;
          setPaths((prev) => [...prev, currentPathRef.current as string]);
          currentPathRef.current = null;
          setCurrentPath(null);
        },
        onPanResponderTerminate: () => {
          if (disabled) return;
          currentPathRef.current = null;
          setCurrentPath(null);
        },
      }),
    [disabled],
  );

  return (
    <View style={styles.container} testID="signature-pad">
      <Text style={styles.title}>{t('signatures.signaturePadTitle')}</Text>
      <Text style={styles.helper}>{t('signatures.signaturePadHelper')}</Text>
      <View style={styles.canvas} {...panResponder.panHandlers} testID="signature-pad-canvas">
        <Svg ref={svgRef} height="100%" width="100%">
          {paths.map((path, index) => (
            <Path
              key={`path-${index}`}
              d={path}
              stroke="#0F172A"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentPath ? (
            <Path
              d={currentPath}
              stroke="#0F172A"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </Svg>
      </View>
      <View style={styles.actions}>
        <Button
          title={t('signatures.signaturePadClear')}
          onPress={handleClear}
          disabled={disabled}
          testID="signature-pad-clear"
        />
        <Button
          title={t('signatures.signaturePadSave')}
          onPress={handleSave}
          disabled={disabled || !hasSignature}
          testID="signature-pad-save"
        />
      </View>
      {value?.signedAt ? (
        <Text style={styles.caption}>{t('signatures.signaturePadSignedAt', { date: value.signedAt })}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: '#CBD5F5',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#F8FAFF',
    marginTop: 12,
  },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  helper: { fontSize: 12, color: '#475569', marginBottom: 8 },
  canvas: {
    height: 160,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  actions: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  caption: {
    marginTop: 8,
    fontSize: 11,
    color: '#475569',
  },
});
