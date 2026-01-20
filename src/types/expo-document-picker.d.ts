declare module 'expo-document-picker' {
  export type DocumentPickerAsset = {
    uri: string;
    name?: string | null;
    mimeType?: string | null;
    size?: number | null;
  };

  export type DocumentPickerResult =
    | { canceled: boolean; assets?: DocumentPickerAsset[] }
    | { type?: string; uri?: string; name?: string; mimeType?: string; size?: number };

  export function getDocumentAsync(options?: {
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }): Promise<DocumentPickerResult>;
}
