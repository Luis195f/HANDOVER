import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import PatientList from "@/src/screens/PatientList";
import HandoverForm from "@/src/screens/HandoverForm";
import AudioNote from "@/src/screens/AudioNote";
import QRScan from "@/src/screens/QRScan";

/** Params que acepta la ruta de Handover */
export type HandoverFormParams = {
  /** opcional: si abres el formulario “vacío” o desde QR */
  patientId?: string;
  /** opcional: id o nombre de la unidad para preselección */
  unit?: string;
  /** opcional: texto de especialidad a prefijar en notas */
  specialty?: string;
};

export type RootStackParamList = {
  PatientList: undefined;
  HandoverForm: HandoverFormParams | undefined;
  AudioNote: undefined;
  QRScan: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="PatientList"
        component={PatientList}
        options={{ title: "Handover — Pacientes" }}
      />
      <Stack.Screen
        name="HandoverForm"
        component={HandoverForm}
        options={{ title: "Entrega de Turno" }}
      />
      <Stack.Screen
        name="AudioNote"
        component={AudioNote}
        options={{ title: "Nota de audio" }}
      />
      <Stack.Screen
        name="QRScan"
        component={QRScan}
        options={{ title: "Escanear pulsera" }}
      />
    </Stack.Navigator>
  );
}
