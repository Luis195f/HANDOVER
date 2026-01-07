import React, { useCallback } from 'react';
import { Alert, Button, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AttachmentItem } from '@/src/types/handover';

type AttachWarnCode =
  | 'ATTACH_PICK_CANCELLED'
  | 'ATTACH_PERMISSION_DENIED'
  | 'ATTACH_TOO_LARGE'
  | 'ATTACH_UNSUPPORTED_TYPE'
  | 'ATTACH_READ_FAILED'
  | 'ATTACH_MIME_FALLBACK'
  | 'ATTACH_EMBED_OK'
  | 'ATTACH_EMBED_SKIPPED';

function warnAttach(code: AttachWarnCode, meta?: Record<string, unknown>) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.warn(`[handover][attachments][${code}]`, meta ?? {});
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_COUNT = 10;

type Props = {
  value: AttachmentItem[];
  onChange: (next: AttachmentItem[]) => void;
  maxBytes?: number;
  maxCount?: number;
  disabled?: boolean;
};

const styles = StyleSheet.create({
  container: { gap: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#F9FAFB',
  },
  thumbnail: { width: 36, height: 36, borderRadius: 4, marginRight: 8 },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '500', color: '#111827' },
  meta: { fontSize: 12, color: '#6B7280' },
  remove: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fee2e2', borderRadius: 6 },
  removeText: { fontSize: 12, color: '#991b1b', fontWeight: '600' },
});

const resolveKind = (contentType?: string, fallback?: AttachmentItem['kind']) => {
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  return fallback ?? 'other';
};

export function FileAttach({
  value,
  onChange,
  maxBytes = DEFAULT_MAX_BYTES,
  maxCount = DEFAULT_MAX_COUNT,
  disabled,
}: Props) {
  const canAppend = value.length < maxCount;

  const appendItem = useCallback(
    (item: AttachmentItem) => {
      if (!canAppend) {
        Alert.alert('Límite de adjuntos', `Máximo ${maxCount} archivos.`);
        return;
      }
      onChange([...value, item]);
    },
    [canAppend, maxCount, onChange, value],
  );

  const handlePickImage = useCallback(async () => {
    if (disabled) return;
    const ImagePicker = await import('expo-image-picker').catch(() => null);
    if (!ImagePicker) {
      warnAttach('ATTACH_UNSUPPORTED_TYPE', { contentType: 'image/*' });
      Alert.alert('Adjuntos no disponibles', 'No se pudo acceder al selector de imágenes.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      warnAttach('ATTACH_PERMISSION_DENIED', { permission: 'media-library' });
      Alert.alert('Permiso requerido', 'Habilita acceso a la galería para adjuntar imágenes.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if ('canceled' in result && result.canceled) {
      warnAttach('ATTACH_PICK_CANCELLED', { source: 'image-library' });
      return;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }

    const size = typeof asset.fileSize === 'number' ? asset.fileSize : undefined;
    if (typeof size === 'number' && size > maxBytes) {
      warnAttach('ATTACH_TOO_LARGE', { bytes: size, maxBytes, kind: 'image', contentType: asset.mimeType });
      Alert.alert('Archivo demasiado grande', 'El máximo permitido es 5 MB.');
      return;
    }

    appendItem({
      uri: asset.uri,
      name: asset.fileName ?? undefined,
      contentType: asset.mimeType ?? undefined,
      size,
      kind: resolveKind(asset.mimeType, 'image'),
    });
  }, [appendItem, disabled, maxBytes]);

  const handlePickPdf = useCallback(async () => {
    if (disabled) return;
    const DocumentPicker = await import('expo-document-picker').catch(() => null);
    if (!DocumentPicker) {
      warnAttach('ATTACH_UNSUPPORTED_TYPE', { contentType: 'application/pdf' });
      Alert.alert('Adjuntos no disponibles', 'No se pudo acceder al selector de documentos.');
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
    });

    if ('canceled' in result && result.canceled) {
      warnAttach('ATTACH_PICK_CANCELLED', { source: 'document-picker' });
      return;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return;
    }

    const size = typeof asset.size === 'number' ? asset.size : undefined;
    if (typeof size === 'number' && size > maxBytes) {
      warnAttach('ATTACH_TOO_LARGE', {
        bytes: size,
        maxBytes,
        kind: 'pdf',
        contentType: asset.mimeType ?? undefined,
      });
      Alert.alert('Archivo demasiado grande', 'El máximo permitido es 5 MB.');
      return;
    }

    appendItem({
      uri: asset.uri,
      name: asset.name ?? undefined,
      contentType: asset.mimeType ?? undefined,
      size,
      kind: resolveKind(asset.mimeType, 'pdf'),
    });
  }, [appendItem, disabled, maxBytes]);

  const handleRemove = useCallback(
    (index: number) => {
      const next = value.filter((_, i) => i !== index);
      onChange(next);
    },
    [onChange, value],
  );

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Button title="Adjuntar imagen" onPress={handlePickImage} disabled={disabled || !canAppend} />
        <Button title="Adjuntar PDF" onPress={handlePickPdf} disabled={disabled || !canAppend} />
      </View>

      {value.length > 0 ? (
        <View style={styles.list}>
          {value.map((item, index) => {
            const displayName = item.name ?? (item.kind === 'pdf' ? 'Documento PDF' : 'Archivo adjunto');
            return (
              <View key={`${item.uri}-${index}`} style={styles.item}>
                {item.kind === 'image' ? (
                  <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                ) : (
                  <View style={[styles.thumbnail, { backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#374151' }}>
                      {item.kind === 'pdf' ? 'PDF' : 'FILE'}
                    </Text>
                  </View>
                )}
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {item.contentType ? <Text style={styles.meta}>{item.contentType}</Text> : null}
                </View>
                <Pressable style={styles.remove} onPress={() => handleRemove(index)}>
                  <Text style={styles.removeText}>Eliminar</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
