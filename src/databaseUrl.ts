/** Parsed PostgreSQL connection string components. */
export interface DatabaseUrlParts {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

/** Default connection string for local dev against the Docker `db` service on the host. */
export const DEFAULT_DATABASE_URL = 'postgresql://transynth:transynth@localhost:5433/transynth';

/** Resolve the active database URL from the environment. */
export const resolveDatabaseUrl = (): string => process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

/**
 * Parse a PostgreSQL connection URL into its components.
 *
 * Supports `postgresql://` and `postgres://` schemes.
 */
export const parseDatabaseUrl = (url: string): DatabaseUrlParts => {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '');
  if (!parsed.username || !database) {
    throw new Error('DATABASE_URL must include username and database name');
  }

  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database,
  };
};
