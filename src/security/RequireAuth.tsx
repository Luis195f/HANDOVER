import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { getTokens } from '@/src/lib/auth';

type Props = {
  children: React.ReactNode;
};

export default function RequireAuth({ children }: Props) {
  const nav = useNavigation<any>();
  const [ready, setReady] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      (async () => {
        const tokens = await getTokens();
        if (!active) return;
        if (!tokens?.access_token) {
          nav.reset({ index: 0, routes: [{ name: 'Login' as never }] });
        } else {
          setReady(true);
        }
      })();
      return () => {
        active = false;
        setReady(false);
      };
    }, [nav])
  );

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <>{children}</>;
}
