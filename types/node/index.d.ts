export {};
declare global {
  var process: {
    env: Record<string, string | undefined> & {
      NODE_ENV?: string;
      EXPO_PUBLIC_API_BASE?: string;
      EXPO_PUBLIC_API_TOKEN?: string;
      EXPO_PUBLIC_FHIR_BASE?: string;
      API_BASE?: string;
      API_TOKEN?: string;
      BYPASS_SCOPE?: string;
      EXPO_PUBLIC_BYPASS_SCOPE?: string;
    };
  };
  var __DEV__: boolean;
  interface NodeRequire {
    (moduleName: string): any;
  }
  var require: NodeRequire;
}
