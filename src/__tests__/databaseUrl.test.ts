import { parseDatabaseUrl, resolveDatabaseUrl, DEFAULT_DATABASE_URL } from '../databaseUrl';

describe('parseDatabaseUrl', () => {
  it('parses a standard postgresql URL', () => {
    expect(parseDatabaseUrl('postgresql://localizer:localizer@localhost:5433/localizer')).toEqual({
      user: 'localizer',
      password: 'localizer',
      host: 'localhost',
      port: '5433',
      database: 'localizer',
    });
  });
});

describe('resolveDatabaseUrl', () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('returns DATABASE_URL when set', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@host:9999/db';
    expect(resolveDatabaseUrl()).toBe('postgresql://u:p@host:9999/db');
  });

  it('falls back to the default URL', () => {
    delete process.env.DATABASE_URL;
    expect(resolveDatabaseUrl()).toBe(DEFAULT_DATABASE_URL);
  });
});
