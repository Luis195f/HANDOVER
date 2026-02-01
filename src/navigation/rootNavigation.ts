import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();

export function resetToRoot(name: keyof RootStackParamList) {
  if (!rootNavigationRef.isReady()) return;
  rootNavigationRef.reset({
    index: 0,
    routes: [{ name }],
  });
}
