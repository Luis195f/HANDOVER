declare module 'expo-image-picker' {
  export type ImagePickerAsset = {
    uri: string;
    fileName?: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
  };

  export type ImagePickerResult =
    | { canceled: boolean; assets?: ImagePickerAsset[] }
    | { cancelled?: boolean; uri?: string };

  export const MediaTypeOptions: {
    Images: string;
  };

  export function requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  export function requestCameraPermissionsAsync(): Promise<{ granted: boolean }>;
  export function launchImageLibraryAsync(options?: {
    mediaTypes?: string;
    quality?: number;
  }): Promise<ImagePickerResult>;
  export function launchCameraAsync(options?: {
    mediaTypes?: string;
    quality?: number;
  }): Promise<ImagePickerResult>;
}
