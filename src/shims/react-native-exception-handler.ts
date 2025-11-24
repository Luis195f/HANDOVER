type ErrorHandler = (error: Error, isFatal?: boolean) => void;

let globalHandler: ErrorHandler | null = null;

export function setJSExceptionHandler(handler: ErrorHandler, _allowInDevMode = false): void {
  globalHandler = handler;
}

export const ErrorUtils = {
  setGlobalHandler(handler: ErrorHandler) {
    globalHandler = handler;
  },
  getGlobalHandler(): ErrorHandler | null {
    return globalHandler;
  },
};

export function triggerHandler(error: Error, isFatal = false): void {
  globalHandler?.(error, isFatal);
}
