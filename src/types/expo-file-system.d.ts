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

  export type WriteAsStringOptions = {
    encoding?: string;
  };

  export type DeleteOptions = {
    idempotent?: boolean;
  };

  export type MoveOptions = {
    from: string;
    to: string;
  };

  export type CopyOptions = {
    from: string;
    to: string;
  };

  export const EncodingType: {
    Base64: 'base64';
    UTF8?: 'utf8';
  };

  export const documentDirectory: string | null;

  export function readAsStringAsync(uri: string, options?: ReadAsStringOptions): Promise<string>;
  export function writeAsStringAsync(
    uri: string,
    contents: string,
    options?: WriteAsStringOptions,
  ): Promise<void>;

  export function copyAsync(options: CopyOptions): Promise<void>;

  export function getInfoAsync(uri: string): Promise<FileInfo>;
  export function deleteAsync(uri: string, options?: DeleteOptions): Promise<void>;
  export function moveAsync(options: MoveOptions): Promise<void>;

  const FileSystem: {
    readAsStringAsync: typeof readAsStringAsync;
    writeAsStringAsync: typeof writeAsStringAsync;
    copyAsync: typeof copyAsync;
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
