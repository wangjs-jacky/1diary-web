import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.querySelector('.ProseMirror');
}
