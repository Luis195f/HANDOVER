declare module 'expo-file-system' {
  export type FileInfo = {
    exists: boolean;
    isDirectory?: boolean;
    size?: number;
    uri?: string;
    modificationTime?: number;
  };

  export type ReadAsStringOptions = {
    encoding?: string;
  };

  export type DeleteOptions = {
    idempotent?: boolean;
  };

  export type MoveOptions = {
    from: string;
    to: string;
  };

  export const EncodingType: {
    Base64: 'base64';
  };

  export const documentDirectory: string | null;

  export function readAsStringAsync(uri: string, options?: ReadAsStringOptions): Promise<string>;
  export function getInfoAsync(uri: string): Promise<FileInfo>;
  export function deleteAsync(uri: string, options?: DeleteOptions): Promise<void>;
  export function moveAsync(options: MoveOptions): Promise<void>;

  const FileSystem: {
    readAsStringAsync: typeof readAsStringAsync;
    getInfoAsync: typeof getInfoAsync;
    deleteAsync: typeof deleteAsync;
    moveAsync: typeof moveAsync;
    EncodingType: typeof EncodingType;
    documentDirectory: typeof documentDirectory;
  };
  export = FileSystem;
}

declare module 'expo-file-system/legacy' {
  import FileSystem = require('expo-file-system');
  export = FileSystem;
}

declare module 'expo-file-system/*' {
  import FileSystem = require('expo-file-system');
  export = FileSystem;
}
