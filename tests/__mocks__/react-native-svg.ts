// tests/__mocks__/react-native-svg.ts
// Stub mínimo de react-native-svg para tests en Vitest/Node.

import React, { forwardRef, useImperativeHandle } from 'react';

let mockDataUrl = 'mock-signature';

export const __setMockSvgDataUrl = (value: string) => {
  mockDataUrl = value;
};

// Componente no-op para todos los elementos SVG
const SvgElement = forwardRef((_props: Record<string, unknown>, ref) => {
  useImperativeHandle(ref, () => ({
    toDataURL: (cb: (data: string) => void) => cb(mockDataUrl),
  }));
  return null;
});

export const Svg = SvgElement;
export const Path = (_props: Record<string, unknown>) => null;
export const Circle = (_props: Record<string, unknown>) => null;
export const Rect = (_props: Record<string, unknown>) => null;
export const G = (_props: Record<string, unknown>) => null;
export const Line = (_props: Record<string, unknown>) => null;
export const Polyline = (_props: Record<string, unknown>) => null;
export const Polygon = (_props: Record<string, unknown>) => null;
export const Text = (_props: Record<string, unknown>) => null;
export const Defs = (_props: Record<string, unknown>) => null;
export const Stop = (_props: Record<string, unknown>) => null;
export const LinearGradient = (_props: Record<string, unknown>) => null;
export const RadialGradient = (_props: Record<string, unknown>) => null;
export const ClipPath = (_props: Record<string, unknown>) => null;

export default SvgElement;
