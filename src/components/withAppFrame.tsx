// FILE: src/components/withAppFrame.tsx
import React from 'react';
import AppFrame from './AppFrame';

export function withAppFrame<P>(Screen: React.ComponentType<P>) {
  return function Wrapped(props: P) {
    return (
      <AppFrame>
        <Screen {...props} />
      </AppFrame>
    );
  };
}
