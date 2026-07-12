import { isPgTransientError, withPgRetry } from '../db';

describe('isPgTransientError', () => {
  it('detects PostgreSQL recovery (57P03)', () => {
    expect(
      isPgTransientError(
        Object.assign(new Error('the database system is not yet accepting connections'), {
          code: '57P03',
        }),
      ),
    ).toBe(true);
  });

  it('detects connection terminated message', () => {
    expect(isPgTransientError(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  it('ignores non-transient errors', () => {
    expect(isPgTransientError(new Error('syntax error at or near'))).toBe(false);
  });
});

describe('withPgRetry', () => {
  it('retries transient errors then succeeds', async () => {
    let attempts = 0;
    const result = await withPgRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw Object.assign(new Error('not yet accepting connections'), { code: '57P03' });
        }
        return 'ok';
      },
      { maxAttempts: 5 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry permanent errors', async () => {
    let attempts = 0;
    await expect(
      withPgRetry(async () => {
        attempts++;
        throw new Error('unique violation');
      }),
    ).rejects.toThrow('unique violation');
    expect(attempts).toBe(1);
  });
});
