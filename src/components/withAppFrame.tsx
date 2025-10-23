// FILE: src/components/withAppFrame.tsx
import React, { type JSX as JSXNamespace } from 'react';
import AppFrame from './AppFrame';

export function withAppFrame<P extends JSXNamespace.IntrinsicAttributes>(
  Screen: React.ComponentType<P>,
) {
  const Wrapped: React.FC<P> = (props) => (
    <AppFrame>
      <Screen {...props} />
    </AppFrame>
  );
  Wrapped.displayName = `WithAppFrame(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return Wrapped;
}
