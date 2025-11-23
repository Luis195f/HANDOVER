import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Speech from 'expo-speech';

type Props = { text: string; label?: string };

export default function TtsButton({ text, label = 'Reproducir (TTS)' }: Props) {
  const [playing, setPlaying] = useState(false);
  const supported = typeof Speech?.speak === 'function';

  useEffect(() => {
    return () => {
      if (supported) {
        Speech.stop();
      }
    };
  }, [supported]);

  const handlePress = () => {
    if (!supported) {
      return;
    }
    if (playing) {
      Speech.stop();
      setPlaying(false);
      return;
    }
    if (!text?.trim()) {
      return;
    }
    setPlaying(true);
    Speech.speak(text, {
      language: 'es',
      onDone: () => setPlaying(false),
      onStopped: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  };

  if (!supported) {
    return (
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: '#E5E7EB',
        }}
        accessibilityLabel="Text-to-speech no disponible"
      >
        <Text style={{ fontWeight: '600', color: '#6B7280' }}>TTS no disponible en este dispositivo</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ busy: playing }}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: playing ? '#2563EB' : '#E0E7FF',
        opacity: pressed ? 0.85 : 1,
        alignItems: 'center',
        minWidth: 160,
      })}
    >
      {playing ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={{ fontWeight: '600', color: playing ? '#fff' : '#1E1B4B' }}>{label}</Text>
      )}
    </Pressable>
  );
}
