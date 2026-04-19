import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerConfig } from './startServer';

describe('socketApiContext config', () => {
  const mockConfig: ServerConfig = {
    name: 'test-socket',
    server: {} as ServerConfig['server'],
  };

  beforeEach(async () => {
    vi.resetModules();
    const { setConfig } = await import('./async-context/socketApiContext');
    setConfig(mockConfig);
  });

  describe('useConfig', () => {
    it('returns the config that was set', async () => {
      const { useConfig } = await import('./async-context/socketApiContext');
      const result = useConfig();
      expect(result).toBe(mockConfig);
      expect(result.name).toBe('test-socket');
    });

    it('throws when config has not been set', async () => {
      vi.resetModules();
      const { useConfig } = await import('./async-context/socketApiContext');
      expect(() => useConfig()).toThrow(/required value "config"/);
    });
  });

  describe('setConfig', () => {
    it('allows updating the config', async () => {
      const { setConfig, useConfig } = await import('./async-context/socketApiContext');
      const newConfig: ServerConfig = {
        name: 'updated-socket',
        server: {} as ServerConfig['server'],
      };
      setConfig(newConfig);
      expect(useConfig()).toBe(newConfig);
      expect(useConfig().name).toBe('updated-socket');
    });
  });
});
