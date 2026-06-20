import { createLogger } from './logger';

describe('createLogger', () => {
  it('creates a subsystem-scoped logger', () => {
    const logger = createLogger('test');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.isTrace).toBe('function');
  });
});

describe('log formatting', () => {
  it('does not throw when logging structured context', () => {
    const logger = createLogger('test');
    expect(() => logger.info('hello', { a: 1 })).not.toThrow();
    expect(() => logger.info({ a: 1 }, 'hello')).not.toThrow();
  });
});
