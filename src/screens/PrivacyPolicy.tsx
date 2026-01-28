import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/src/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PrivacyPolicy'>;

const sections = [
  {
    title: 'Responsable del tratamiento',
    body:
      'HANDOVER-Pro es el responsable del tratamiento de los datos personales. Puedes contactar en privacidad@handover-pro.example.',
  },
  {
    title: 'Finalidad del tratamiento',
    body:
      'Gestionar el acceso a la aplicación clínica, registrar información necesaria para el pase de turno y asegurar la continuidad asistencial.',
  },
  {
    title: 'Base legal',
    body: 'Consentimiento explícito del usuario, prestación del servicio y cumplimiento de obligaciones legales sanitarias.',
  },
  {
    title: 'Datos tratados',
    body:
      'Datos identificativos del profesional, datos clínicos mínimos (signos vitales, escalas, dispositivos, tareas) y metadatos de uso/auditoría.',
  },
  {
    title: 'Conservación',
    body:
      'Los datos se conservan solo durante el tiempo necesario para las finalidades y requisitos legales, y luego se eliminan o anonimizan.',
  },
  {
    title: 'Terceros y transferencias',
    body:
      'No se comparten datos con terceros salvo obligación legal o necesidad para prestar el servicio con acuerdos de confidencialidad.',
  },
  {
    title: 'Derechos RGPD',
    body:
      'Puedes ejercer derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad contactando al responsable.',
  },
  {
    title: 'Contacto y borrado de datos',
    body:
      'Escribe a privacidad@handover-pro.example indicando tu identificación profesional y solicitud. Se validará la identidad y se gestionará el borrado por el endpoint interno o panel de administración.',
  },
];

export default function PrivacyPolicy({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Política de privacidad</Text>
        <Text style={styles.subtitle}>Última actualización: 2024-01-01</Text>
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
        <Text style={styles.backButtonText}>Volver</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#CBD5E1',
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#CBD5E1',
  },
  backButton: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    alignItems: 'center',
    backgroundColor: '#0B1120',
  },
  backButtonText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 16,
  },
});
