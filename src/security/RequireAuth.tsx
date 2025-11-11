import React from "react";
import { Platform } from "react-native";

/**
 * Bypass de autenticación SOLO para desarrollo.
 * Cuando se implemente OAuth real, restaurar el archivo original desde .bak.
 */
type Props = { children: React.ReactNode };

const DEV_BYPASS =
  __DEV__ && (process.env.DEV_BYPASS_AUTH === "1" || Platform.OS === "web");

export default function RequireAuth({ children }: Props) {
  if (DEV_BYPASS) return <>{children}</>;
  // Fallback: si no hay bypass, mostramos el login mock para no romper navegación
  const LoginMock = require("../screens/LoginMock").default;
  return <LoginMock />;
}
