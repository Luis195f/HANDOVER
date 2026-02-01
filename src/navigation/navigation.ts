import { CommonActions, createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "@/src/navigation/types";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let _isReady = false;
const _queue: Array<() => void> = [];

export function onReady() {
  _isReady = true;
  while (_queue.length) {
    const fn = _queue.shift();
    try {
      fn?.();
    } catch {}
  }
}

function runOrQueue(fn: () => void) {
  if (_isReady && navigationRef.isReady()) fn();
  else _queue.push(fn);
}

export function resetTo(name: keyof RootStackParamList) {
  runOrQueue(() => {
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name }],
      }),
    );
  });
}
