import { it, expect } from 'vitest';
it('window should be undefined in server tests', () => {
  const windowType = typeof window;
  console.log('window type:', windowType);
  expect(windowType).toBe('undefined');
});
