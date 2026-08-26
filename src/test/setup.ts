import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

if (typeof globalThis.localStorage?.getItem !== 'function') {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    },
  });
}

if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.querySelector('.ProseMirror');
}
