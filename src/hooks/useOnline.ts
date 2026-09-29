import { useSyncExternalStore } from 'react';

// Tracks navigator.onLine so the shell can say when saves cannot reach the server.
function subscribe(callback: () => void) {
  globalThis.addEventListener('online', callback);
  globalThis.addEventListener('offline', callback);
  return () => {
    globalThis.removeEventListener('online', callback);
    globalThis.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
