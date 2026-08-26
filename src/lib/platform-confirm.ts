import { Alert, Platform } from 'react-native';

export type ConfirmationOptions = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
};

export function confirmAction({
  title,
  message,
  confirmText,
  cancelText,
}: ConfirmationOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof globalThis.confirm !== 'function') {
      return Promise.resolve(false);
    }
    return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
