/**
 * Where the database tests run, and the guard that keeps them off real data.
 *
 * The suite drops and recreates this database on every run, so the name must
 * say it is a test database. Plain JavaScript because Jest loads it from the
 * global setup, outside the TypeScript transform.
 */

/** Matches `docker/compose.test-db.yml`. */
export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://transynth:transynth@localhost:55433/transynth_test';

/** `TEST_DATABASE_URL`, or the compose test database when it is unset. */
export const resolveTestDatabaseUrl = () => {
  const url = new URL(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/_test$/.test(name)) {
    throw new Error(
      `Refusing to run database tests against "${name}": the suite drops and recreates ` +
        'its database, so TEST_DATABASE_URL must name one ending in "_test".',
    );
  }
  return { url: url.toString(), name };
};
