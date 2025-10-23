// FILE: src/components/withAppFrame.tsx
import React from 'react';
import AppFrame from './AppFrame';

export function withAppFrame<P extends Record<string, unknown>>(
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
