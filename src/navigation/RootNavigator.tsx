// src/navigation/RootNavigator.tsx
import * as React from "react";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import LoginScreen from "@/src/screens/LoginScreen";
import PatientList from "@/src/screens/PatientList";
import AudioNote from "@/src/screens/AudioNote";
import HandoverMain from "@/src/screens/HandoverMain";
import QRScan from "@/src/screens/QRScan";
import PatientDashboard from "@/src/screens/PatientDashboard";
import { useAuth } from "@/src/lib/auth/AuthContext";

export type RootStackParamList = {
  Login: undefined;
  PatientList: undefined;
  Handover:
    | {
        patientId?: string;
        patientIdParam?: string;
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;
  PatientDashboard: { patientId: string };
  AudioNote: { onDoneRoute?: keyof RootStackParamList } | undefined;
  QRScan:
    | {
        returnTo?: "Handover" | "HandoverForm" | "PatientList" | "AudioNote";
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;
  HandoverForm?:
    | {
        patientIdParam?: string;
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Navigator: any = Stack.Navigator;
const Screen: any = Stack.Screen;

function HandoverRedirect({ route, navigation }: any) {
  useEffect(() => {
    const params = route?.params ?? {};
    const { patientId, patientIdParam, unitIdParam, specialtyId } = params;

    navigation.replace("Handover", {
      patientId: patientId ?? patientIdParam,
      unitIdParam,
      specialtyId,
    });
  }, [route, navigation]);

  return null;
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Navigator
      initialRouteName={isAuthenticated ? "PatientList" : "Login"}
      screenOptions={{ headerShown: false }}
    >
      {isAuthenticated ? (
        <>
          <Screen
            name="PatientList"
            component={PatientList}
            options={{ title: "Pacientes", headerShown: true }}
          />

          <Screen
            name="Handover"
            component={HandoverMain}
            options={{ title: "Entrega de turno", headerShown: true }}
          />

          <Screen
            name="PatientDashboard"
            component={PatientDashboard}
            options={{ title: "Dashboard clínico", headerShown: true }}
          />

          <Screen
            name="AudioNote"
            component={AudioNote}
            options={{ title: "Notas de audio", headerShown: true }}
          />

          <Screen
            name="QRScan"
            component={QRScan}
            options={{ title: "Escanear", headerShown: true }}
          />

          <Screen
            name="HandoverForm"
            component={HandoverRedirect}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      )}
    </Navigator>
  );
}

