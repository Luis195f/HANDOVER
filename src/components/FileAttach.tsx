import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFieldArray, useFormContext } from 'react-hook-form';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

import { useThemeTokens } from '@/src/theme';
import type { HandoverValues } from '@/src/validation/schemas';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const IMAGE_QUALITY = 0.6;

type AttachmentInput = NonNullable<HandoverValues['attachments']>[number];

type PickerAsset = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const FILE_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
};

const resolveContentTypeFromUri = (uri: string, fallback: string) => {
  const clean = uri.split('?')[0]?.split('#')[0] ?? '';
  const ext = clean.split('.').pop()?.toLowerCase();
  if (!ext) return fallback;
  return IMAGE_MIME_BY_EXT[ext] ?? FILE_MIME_BY_EXT[ext] ?? fallback;
};

const resolveFileName = (uri: string, fallback: string) => {
  const clean = uri.split('?')[0]?.split('#')[0] ?? '';
  const name = clean.split('/').pop();
  return name && name.length > 0 ? name : fallback;
};

const truncateMiddle = (value: string, max = 28) => {
  if (value.length <= max) return value;
  const slice = Math.max(6, Math.floor((max - 3) / 2));
  return `${value.slice(0, slice)}…${value.slice(-slice)}`;
};

const getImageAsset = (result: ImagePicker.ImagePickerResult): PickerAsset | null => {
  const canceled = 'canceled' in result ? result.canceled : (result as { cancelled?: boolean }).cancelled;
  if (canceled) return null;
  const asset = 'assets' in result ? result.assets?.[0] : (result as ImagePicker.ImagePickerAsset | undefined);
  if (!asset?.uri) return null;
  return {
    uri: asset.uri,
    name: (asset as { fileName?: string | null }).fileName ?? null,
    mimeType: (asset as { mimeType?: string | null }).mimeType ?? null,
    size: (asset as { fileSize?: number | null }).fileSize ?? null,
  };
};

const getDocumentAsset = (result: DocumentPicker.DocumentPickerResult): PickerAsset | null => {
  const canceled =
    'canceled' in result
      ? result.canceled
      : (result as { type?: string }).type === 'cancel';
  if (canceled) return null;
  const asset =
    'assets' in result ? result.assets?.[0] : (result as DocumentPicker.DocumentPickerResult);
  const uri = (asset as { uri?: string }).uri;
  if (!uri) return null;
  return {
    uri,
    name: (asset as { name?: string | null }).name ?? null,
    mimeType: (asset as { mimeType?: string | null }).mimeType ?? null,
    size: (asset as { size?: number | null }).size ?? null,
  };
};

export default function FileAttach() {
  const { colors, radius } = useThemeTokens();
  const { control } = useFormContext<HandoverValues>();
  const { fields, remove, append } = useFieldArray({ control, name: 'attachments' });
  const [sheetVisible, setSheetVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const attachments = useMemo(
    () => fields.map((field) => field as AttachmentInput & { id: string }),
    [fields],
  );

  const checkFileSize = useCallback(async (asset: PickerAsset) => {
    const reportedSize = typeof asset.size === 'number' ? asset.size : undefined;
    if (reportedSize != null) return reportedSize;
    const info = await FileSystem.getInfoAsync(asset.uri);
    if (info.exists && !info.isDirectory && typeof info.size === 'number') {
      return info.size;
    }
    return undefined;
  }, []);

  const addAttachment = useCallback(
    async (asset: PickerAsset, fallbackName: string, fallbackContentType: string) => {
      setLoading(true);
      try {
        const size = await checkFileSize(asset);
        if (size && size > MAX_ATTACHMENT_BYTES) {
          Alert.alert(
            'Archivo muy grande',
            'El archivo supera el tamaño máximo permitido de 5MB. No se adjuntó.',
          );
          console.warn('[HNDV][WARN][ATTACH_OVERSIZE_SKIPPED]', {
            fileName: asset.name ?? fallbackName,
            sizeMB: (size / 1024 / 1024).toFixed(1),
          });
          return;
        }

        const data = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const contentType =
          (asset.mimeType && asset.mimeType.length > 0
            ? asset.mimeType
            : resolveContentTypeFromUri(asset.uri, fallbackContentType)) ?? fallbackContentType;
        const name = asset.name ?? resolveFileName(asset.uri, fallbackName);

        const newAttachment: AttachmentInput = {
          uri: asset.uri,
          contentType,
          name,
          data,
        };

        append(newAttachment);

        console.warn('[HNDV][INFO][ATTACH_ADDED]', {
          fileName: newAttachment.name,
          contentType: newAttachment.contentType,
          size: newAttachment.data.length,
        });
      } catch {
        Alert.alert('Adjuntos', 'No se pudo adjuntar el archivo seleccionado.');
      } finally {
        setLoading(false);
      }
    },
    [append, checkFileSize],
  );

  const pickFromLibrary = useCallback(async () => {
    setSheetVisible(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Se necesita permiso para acceder a la galería.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: IMAGE_QUALITY,
    });
    const asset = getImageAsset(result);
    if (!asset) return;
    await addAttachment(asset, `foto-${Date.now()}.jpg`, 'image/jpeg');
  }, [addAttachment]);

  const takePhoto = useCallback(async () => {
    setSheetVisible(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Se necesita permiso para usar la cámara.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: IMAGE_QUALITY,
    });
    const asset = getImageAsset(result);
    if (!asset) return;
    await addAttachment(asset, `foto-${Date.now()}.jpg`, 'image/jpeg');
  }, [addAttachment]);

  const pickDocument = useCallback(async () => {
    setSheetVisible(false);
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = getDocumentAsset(result);
    if (!asset) return;
    await addAttachment(asset, `documento-${Date.now()}`, 'application/octet-stream');
  }, [addAttachment]);

  return (
    <View style={styles.container}>
      <View style={styles.buttonRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Adjuntar archivo"
          onPress={() => setSheetVisible(true)}
          style={({ pressed }) => [
            styles.attachButton,
            { backgroundColor: colors.primary, borderRadius: radius.sm },
            pressed && styles.attachButtonPressed,
          ]}
        >
          <Text style={styles.attachButtonText}>Adjuntar archivo</Text>
        </Pressable>
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.muted }]}>Procesando…</Text>
          </View>
        )}
      </View>

      {attachments.length > 0 && (
        <View style={styles.list}>
          {attachments.map((attachment, index) => {
            const name = attachment.name ?? 'Adjunto sin nombre';
            const isImage = attachment.contentType?.startsWith('image/');
            const icon = isImage ? 'insert-photo' : 'insert-drive-file';
            const typeLabel = isImage ? 'imagen' : 'documento';
            return (
              <View
                key={attachment.id}
                accessible
                accessibilityLabel={`Archivo adjunto: ${name}, tipo: ${typeLabel}`}
                style={[
                  styles.item,
                  { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sm },
                ]}
              >
                <MaterialIcons name={icon} size={20} color={colors.muted} />
                <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                  {truncateMiddle(name)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar ${name}`}
                  onPress={() => remove(index)}
                  style={({ pressed }) => [
                    styles.removeButton,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <MaterialIcons name="close" size={18} color={colors.muted} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <Modal
        animationType="fade"
        transparent
        visible={sheetVisible}
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetVisible(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderRadius: radius.md }]}
          >
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Adjuntar archivo</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Seleccionar imagen de galería"
              onPress={pickFromLibrary}
              style={({ pressed }) => [styles.sheetOption, pressed && styles.sheetOptionPressed]}
            >
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>Seleccionar imagen de galería</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tomar foto"
              onPress={takePhoto}
              style={({ pressed }) => [styles.sheetOption, pressed && styles.sheetOptionPressed]}
            >
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>Tomar foto</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Seleccionar documento"
              onPress={pickDocument}
              style={({ pressed }) => [styles.sheetOption, pressed && styles.sheetOptionPressed]}
            >
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>Seleccionar documento</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              onPress={() => setSheetVisible(false)}
              style={({ pressed }) => [styles.sheetOption, pressed && styles.sheetOptionPressed]}
            >
              <Text style={[styles.sheetCancelText, { color: colors.muted }]}>Cancelar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
  },
  buttonRow: {
    gap: 8,
  },
  attachButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButtonPressed: {
    opacity: 0.85,
  },
  attachButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
  },
  list: {
    marginTop: 12,
    gap: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  itemName: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  removeButton: {
    padding: 4,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    padding: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  sheetOption: {
    paddingVertical: 12,
  },
  sheetOptionPressed: {
    opacity: 0.7,
  },
  sheetOptionText: {
    fontSize: 15,
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
