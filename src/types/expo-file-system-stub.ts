type FileInfo = {
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
  uri?: string;
  modificationTime?: number;
};

type FileSystemStub = {
  readAsStringAsync?: (uri: string, options?: { encoding?: string }) => Promise<string>;
  getInfoAsync?: (uri: string) => Promise<FileInfo>;
  deleteAsync?: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  moveAsync?: (options: { from: string; to: string }) => Promise<void>;
  EncodingType?: { Base64: 'base64' };
  documentDirectory?: string | null;
};

export const StorageAccessFramework: Record<string, never> = {};
export const EncodingType = { Base64: 'base64' } as const;
export const documentDirectory: string | null = null;
export const FileSystemUploadType: Record<string, never> = {};
export const FileSystemSessionType: Record<string, never> = {};
export const FileSystemCacheType: Record<string, never> = {};
export const FileSystemUploadOptionsPreset: Record<string, never> = {};

const FileSystem: FileSystemStub = { EncodingType, documentDirectory };

export default FileSystem;
