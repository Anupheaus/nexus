import { afterEach, describe, expect, it } from 'vitest';
import { Logger, LogLevels, type LoggerEntry } from '@anupheaus/common';
import { getClientLogRelayLevel, setClientLogRelayLevel } from './clientLogRelayLevel';

describe('client log relay level', () => {
  afterEach(() => { setClientLogRelayLevel(0); });

  it('relays everything until told otherwise', () => {
    expect(getClientLogRelayLevel()).toBe(0);
  });

  it('follows the level it was last given', () => {
    setClientLogRelayLevel(LogLevels.warn);

    expect(getClientLogRelayLevel()).toBe(LogLevels.warn);
  });

  it('gates a logger listener that reads it, live, without re-registering', () => {
    const relayed: string[] = [];
    const stop = Logger.registerListener({
      maxEntries: 1,
      minLevel: getClientLogRelayLevel,
      onTrigger: (entries: LoggerEntry[]) => { relayed.push(...entries.map(({ message }) => message)); },
    });
    const logger = new Logger('RelayLevelProbe');
    try {
      setClientLogRelayLevel(LogLevels.info);
      logger.debug('quiet');
      logger.info('shipped');

      setClientLogRelayLevel(LogLevels.debug);
      logger.debug('now shipped');

      expect(relayed).toEqual(['shipped', 'now shipped']);
    } finally {
      stop();
    }
  });
});
