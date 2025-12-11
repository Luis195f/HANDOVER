// tests/__mocks__/react-native-svg.ts
// Stub mínimo de react-native-svg para tests en Vitest/Node.

import React from 'react';

// Componente no-op para todos los elementos SVG
const SvgElement = (_props: any) => null;

export const Svg = SvgElement;
export const Path = SvgElement;
export const Circle = SvgElement;
export const Rect = SvgElement;
export const G = SvgElement;
export const Line = SvgElement;
export const Polyline = SvgElement;
export const Polygon = SvgElement;
export const Text = SvgElement;
export const Defs = SvgElement;
export const Stop = SvgElement;
export const LinearGradient = SvgElement;
export const RadialGradient = SvgElement;
export const ClipPath = SvgElement;

export default SvgElement;
