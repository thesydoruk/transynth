import { formatFlatObjectLines, formatLogBlock } from '../format';

describe('formatLogBlock', () => {
  it('formats header and indented fields', () => {
    expect(
      formatLogBlock('Fixed [incorrect] string_id=1 edid (conf=0.95)', {
        reason: 'Wrong order.',
        was: 'Old text',
        fix: 'New text',
      }),
    ).toBe(
      [
        'Fixed [incorrect] string_id=1 edid (conf=0.95)',
        '  reason: Wrong order.',
        '  was: Old text',
        '  fix: New text',
      ].join('\n'),
    );
  });

  it('skips empty fields', () => {
    expect(formatLogBlock('Header', { reason: 'x', was: null, fix: '' })).toBe(
      ['Header', '  reason: x'].join('\n'),
    );
  });
});

describe('formatFlatObjectLines', () => {
  it('formats simple key=value lines', () => {
    expect(formatFlatObjectLines({ jobId: 1, total: 500, dryRun: false })).toBe(
      ['  jobId=1', '  total=500', '  dryRun=false'].join('\n'),
    );
  });

  it('returns null for nested values', () => {
    expect(formatFlatObjectLines({ ids: [1, 2] })).toBeNull();
  });
});

describe('logger structured context', () => {
  it('does not throw when logging flat objects', async () => {
    const { createLogger } = await import('../../logger');
    const logger = createLogger('test');
    expect(() => logger.info('hello', { a: 1 })).not.toThrow();
    expect(() => logger.info({ a: 1 }, 'hello')).not.toThrow();
    expect(formatFlatObjectLines({ jobId: 3, total: 100 })).toContain('jobId=3');
  });
});
