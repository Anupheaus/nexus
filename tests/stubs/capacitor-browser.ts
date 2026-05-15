import { vi } from 'vitest';

export const Browser = {
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};
