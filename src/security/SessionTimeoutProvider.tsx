import React from 'react';
import { AppState, AppStateStatus, View } from 'react-native';

import { t } from '@/src/i18n';
import { logoutAndClear } from '@/src/security/auth';
import { createSessionTimeoutController, SessionTimeoutReason } from '@/src/security/session-timeout';
import { getSessionTimeoutMs } from '@/src/security/session-config';
import { useAuth } from '@/src/security/auth';

export function SessionTimeoutProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const controllerRef = React.useRef<ReturnType<typeof createSessionTimeoutController> | null>(null);
  const { idleMs, hardMs } = React.useMemo(() => getSessionTimeoutMs(), []);

  React.useEffect(() => {
    if (!session) {
      controllerRef.current?.stop();
      controllerRef.current = null;
      return;
    }

    const controller = createSessionTimeoutController({
      idleMs,
      hardMs,
      onTimeout: async (_reason: SessionTimeoutReason) => {
        await logoutAndClear({
          skipRemote: true,
          message: t('auth.sessionExpiredMessage'),
        });
      },
    });

    controllerRef.current = controller;

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      controller.onAppStateChange(state);
    });

    return () => {
      controller.stop();
      controllerRef.current = null;
      subscription.remove();
    };
  }, [idleMs, session]);

  const recordActivity = React.useCallback(() => {
    controllerRef.current?.recordActivity('touch');
  }, []);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        recordActivity();
        return false;
      }}
      onTouchStart={recordActivity}
      onTouchMove={recordActivity}
    >
      {children}
    </View>
  );
}
