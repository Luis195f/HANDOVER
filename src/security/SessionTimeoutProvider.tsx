import React from 'react';
import { AppState, AppStateStatus, View } from 'react-native';

import { t } from '@/src/i18n';
import { logoutAndClear } from '@/src/security/auth';
import { createSessionTimeoutController } from '@/src/security/session-timeout';
import { useAuth } from '@/src/security/auth';

const DEFAULT_IDLE_MINUTES = 10;

function resolveIdleMinutes(): number {
  const raw = process.env.EXPO_PUBLIC_SESSION_IDLE_MINUTES ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_IDLE_MINUTES;
}

export function SessionTimeoutProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const controllerRef = React.useRef<ReturnType<typeof createSessionTimeoutController> | null>(null);
  const idleMs = React.useMemo(() => resolveIdleMinutes() * 60 * 1000, []);

  React.useEffect(() => {
    if (!session) {
      controllerRef.current?.stop();
      controllerRef.current = null;
      return;
    }

    const controller = createSessionTimeoutController({
      idleMs,
      onTimeout: async () => {
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
