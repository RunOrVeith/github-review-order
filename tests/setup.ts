import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom does no layout, so there's never a resize to report
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
