import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export async function initNotifications() {
  Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    console.warn("Permisos de notificaciones no concedidos");
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("news2-alerts", {
      name: "Alertas NEWS2",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [250, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

export async function notifyNews2Alert(
  patientName: string,
  score: number,
  level: "critical" | "urgent",
  suggestions: string[]
) {
  const title =
    level === "critical"
      ? `⚠️ CRÍTICO: NEWS2 ${score}`
      : `⚠️ Urgente: NEWS2 ${score}`;
  const body = `Paciente: ${patientName}\n${suggestions.join(" · ")}`;

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default", priority: "max" },
    trigger: null, // inmediato
  });
}
