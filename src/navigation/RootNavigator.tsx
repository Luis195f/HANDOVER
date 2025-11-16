import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { PatientsScreen } from "@/src/screens/PatientsScreen";
import { HandoverTabs } from "@/src/screens/HandoverTabs";
import { PatientDashboardScreen } from "@/src/screens/PatientDashboard";

export type RootStackParamList = {
  Patients: undefined;
  Handover: { patientId?: string; unitId?: string } | undefined;
  PatientDashboard: { patientId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Patients"
        component={PatientsScreen}
        options={{ title: "Pacientes" }}
      />
      <Stack.Screen
        name="Handover"
        component={HandoverTabs}
        options={{ title: "Handover" }}
      />
      <Stack.Screen
        name="PatientDashboard"
        component={PatientDashboardScreen}
        options={{ title: "Dashboard del Paciente" }}
      />
    </Stack.Navigator>
  );
}
