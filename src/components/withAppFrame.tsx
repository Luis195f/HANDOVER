// @ts-nocheck
import React from 'react';

export function withAppFrame<P extends JSX.IntrinsicAttributes>(Screen: React.ComponentType<P>) {
  const Wrapped: React.FC<P> = (props: P) => <Screen {...props} />;
  Wrapped.displayName = `WithAppFrame(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return Wrapped;
}
