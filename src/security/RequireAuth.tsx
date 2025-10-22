// FILE: src/security/RequireAuth.tsx
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { Session } from '@/src/security/auth';
import { getSession, onAuthChange } from '@/src/security/auth';

type Props = {
  children: React.ReactNode;
  /** Nombre de la ruta de Login en tu navigator */
  redirectTo?: string;
  /** Splash/loader personalizado mientras hidrata la sesión */
  splash?: React.ReactNode;
};

/**
 * RequireAuth
 * - Hidrata sesión desde storage seguro.
 * - Redirige de forma idempotente a Login si no hay sesión (navigation.reset).
 * - Revalida al recuperar foco y reacciona a cambios de sesión (onAuthChange).
 */
export default function RequireAuth({ children, redirectTo = 'Login', splash }: Props) {
  const nav = useNavigation<any>();
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<Session | null>(null);
  const redirected = React.useRef(false);
  const mounted = React.useRef(true);

  const doRedirect = React.useCallback(() => {
    if (!redirected.current) {
      redirected.current = true;
      // Reset para evitar volver atrás a pantallas protegidas sin sesión
      nav.reset({ index: 0, routes: [{ name: redirectTo as never }] });
    }
  }, [nav, redirectTo]);

  const hydrate = React.useCallback(async () => {
    const s = await getSession();
    if (!mounted.current) return;
    setSession(s);
    setLoading(false);
    if (!s) doRedirect();
  }, [doRedirect]);

  // Hidrata en mount + suscripción a cambios de sesión
  React.useEffect(() => {
    mounted.current = true;
    hydrate();
    const unsub = typeof onAuthChange === 'function'
      ? onAuthChange((s) => {
          if (!mounted.current) return;
          setSession(s);
          if (!s) doRedirect();
        })
      : undefined;
    return () => {
      mounted.current = false;
      if (typeof unsub === 'function') unsub();
    };
  }, [hydrate, doRedirect]);

  // Revalida cuando la pantalla recupera foco
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      (async () => {
        const s = await getSession();
        if (!active || !mounted.current) return;
        setSession(s);
        if (!s) doRedirect();
      })();
      return () => {
        active = false;
      };
    }, [doRedirect])
  );

  if (loading) {
    return (
      (splash ?? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ))
    );
  }

  if (!session) return null; // ya se hizo reset hacia Login

  return <>{children}</>;
}
