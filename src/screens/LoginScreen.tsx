import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Controller, useForm } from 'react-hook-form';

import { useAuth } from '@/src/lib/auth/AuthContext';
import { MOCK_CREDENTIALS } from '@/src/lib/auth/AuthService';

type LoginFormValues = {
  username: string;
  password: string;
};

export default function LoginScreen() {
  const { login } = useAuth();
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
    setValue,
  } = useForm<LoginFormValues>({
    defaultValues: {
      username: '',
      password: '',
    },
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    try {
      setError(null);
      await login({ username: values.username.trim(), password: values.password });
    } catch (err) {
      const message = err instanceof Error && err.message === 'INVALID_CREDENTIALS'
        ? 'Credenciales incorrectas. Revisa tu usuario y contraseña.'
        : 'No se pudo iniciar sesión. Inténtalo nuevamente.';
      setError(message);
    }
  });

  const handleFillMock = () => {
    setValue('username', MOCK_CREDENTIALS.username);
    setValue('password', MOCK_CREDENTIALS.password);
    setError(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Inicio de sesión</Text>
        <Text style={styles.subtitle}>Usa tus credenciales de enfermería para continuar.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Usuario o email</Text>
          <Controller
            control={control}
            name="username"
            rules={{ required: 'Ingresa tu usuario o email' }}
            render={({ field: { onChange, onBlur, value }, fieldState: { error: fieldError } }) => (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="nurse@example.com"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  style={[styles.input, fieldError && styles.inputError]}
                  accessibilityLabel="Usuario"
                />
                {fieldError ? <Text style={styles.errorText}>{fieldError.message}</Text> : null}
              </>
            )}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Contraseña</Text>
          <Controller
            control={control}
            name="password"
            rules={{ required: 'Ingresa tu contraseña' }}
            render={({ field: { onChange, onBlur, value }, fieldState: { error: fieldError } }) => (
              <>
                <TextInput
                  placeholder="••••••••"
                  secureTextEntry
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  style={[styles.input, fieldError && styles.inputError]}
                  accessibilityLabel="Contraseña"
                />
                {fieldError ? <Text style={styles.errorText}>{fieldError.message}</Text> : null}
              </>
            )}
          />
        </View>

        {error ? <Text style={styles.formError}>{error}</Text> : null}

        <Pressable
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.submitButton,
            (isSubmitting || pressed) && styles.submitButtonPressed,
          ]}
          accessibilityRole="button"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Iniciar sesión</Text>
          )}
        </Pressable>

        <Pressable onPress={handleFillMock} style={styles.mockButton} accessibilityRole="button">
          <Text style={styles.mockButtonText}>Rellenar credenciales demo</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f4f7',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 24,
    textAlign: 'center',
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d5dd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  inputError: {
    borderColor: '#ff5a5f',
  },
  errorText: {
    color: '#ff5a5f',
    fontSize: 12,
    marginTop: 6,
  },
  formError: {
    color: '#ff5a5f',
    textAlign: 'center',
    marginBottom: 12,
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonPressed: {
    opacity: 0.8,
  },
  submitText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  mockButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  mockButtonText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '500',
  },
});
