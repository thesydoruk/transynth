/**
 * Default user service — ensures a single built-in user exists for activity attribution.
 */

import type pg from 'pg';

/** Built-in user row used to attribute actions in the activity log. */
export interface DefaultUser {
  id: number;
  display_name: string;
  created_at: string;
}

/** Returns the built-in default user (id=1). */
export const getDefaultUser = async (db: pg.Pool): Promise<DefaultUser> => {
  const { rows } = await db.query<DefaultUser>(
    'SELECT id, display_name, created_at FROM users WHERE id = 1',
  );
  return rows[0];
};

/** Ensures the built-in default user exists. Called at server startup. */
export const ensureDefaultUser = async (db: pg.Pool): Promise<void> => {
  const { rows } = await db.query('SELECT id FROM users WHERE id = 1');
  if (rows.length === 0) {
    await db.query(`INSERT INTO users (id, display_name) VALUES (1, 'Default')`);
  }
};
