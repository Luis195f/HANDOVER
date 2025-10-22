import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { getSession, ensureRole, ensureUnit, type Role } from "@/src/security/auth";

type Props = {
  children: React.ReactNode;
  /** Rol o lista de roles requeridos (cualquiera de ellos). */
  role?: Role | Role[];
  /** Unidad requerida (el usuario debe tener acceso). */
  unitId?: string;
  /** (Opcional) UI alternativa cuando se deniega el acceso. */
  fallback?: React.ReactNode;
};

export function RequireAuth({ children, role, unitId, fallback }: Props) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("NO_SESSION");

        if (role) ensureRole(session, role);      // puede lanzar
        if (unitId) ensureUnit(session, unitId);  // puede lanzar

        if (alive) setOk(true);
      } catch {
        if (alive) setOk(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [role, unitId]);

  if (ok === null) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Comprobando permisos…</Text>
      </View>
    );
  }

  if (ok === false) {
    if (fallback) return <>{fallback}</>;
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16 }}>
        <Text style={{ fontWeight: "700", marginBottom: 6 }}>Acceso denegado</Text>
        <Text>No tienes permisos para esta ruta.</Text>
      </View>
    );
  }

  return <>{children}</>;
}

export default RequireAuth;
