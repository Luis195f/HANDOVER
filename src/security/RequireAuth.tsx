import React from "react";
import { Platform } from "react-native";

type Props = { children: React.ReactNode };

// Bypass solo en desarrollo (o en web). Si no toma la env, igual funcionará en web.
const DEV_BYPASS = __DEV__ && (process.env.DEV_BYPASS_AUTH === "1" || Platform.OS === "web");

export default function RequireAuth({ children }: Props) {
  if (DEV_BYPASS) return <>{children}</>;
  const LoginMock = require("../screens/LoginMock").default;
  return <LoginMock />;
}
