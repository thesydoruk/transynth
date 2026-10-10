/**
 * Where live translations flow into the per-game reference base.
 *
 * - {@link snapshotModsToReference}: before a mod purge, keep what it taught.
 * - {@link scheduleReferencePromote}: after a save or a status change that
 *   makes a translation reviewed/human, copy it when the project setting
 *   `workflow.promote_reference_on_approve` is on. Fire-and-forget, like the
 *   RAG sync, so a save is never slowed by it.
 */
import type { Tx } from '../../db';
import { log } from '../../logger';
import {
  promoteTranslationsToReference,
  REFERENCE_PROMOTE_STATUSES,
} from '../data/queries/referenceTranslations';
import { getAllProjectSettings } from './projectSettings';

/** Copy every reviewed/human translation of these mods into the reference base. */
export const snapshotModsToReference = async (db: Tx, modIds: number[]): Promise<number> => {
  if (modIds.length === 0) return 0;
  const { rows } = await db.query<{ target_lang: string }>(
    `SELECT DISTINCT t.target_lang
       FROM translations t
       JOIN strings s ON s.id = t.src_string_id
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = ANY($1::int[])
        AND t.status = ANY($2::text[])`,
    [modIds, [...REFERENCE_PROMOTE_STATUSES]],
  );
  let promoted = 0;
  for (const { target_lang } of rows) {
    promoted += await promoteTranslationsToReference(db, {
      modIds,
      targetLang: target_lang,
      origin: 'delete_snapshot',
    });
  }
  if (promoted > 0) {
    log.info(`Reference snapshot: kept ${promoted} translation(s) from mods ${modIds.join(',')}`);
  }
  return promoted;
};

const isPromotableStatus = (status: string): boolean => REFERENCE_PROMOTE_STATUSES.includes(status);

/**
 * Promote strings whose translation just became reviewed/human, if the
 * project setting asks for it. Never throws; a failure is logged.
 */
export const scheduleReferencePromote = (
  db: Tx,
  stringIds: number[],
  status: string,
  targetLang: string,
): void => {
  if (stringIds.length === 0 || !isPromotableStatus(status)) return;
  void (async () => {
    const settings = await getAllProjectSettings(db);
    if (!settings['workflow.promote_reference_on_approve']) return;
    await promoteTranslationsToReference(db, { stringIds, targetLang, origin: 'auto_approve' });
  })().catch((err: unknown) => {
    log.warn(
      `Reference promote failed for ${stringIds.length} string(s): ${err instanceof Error ? err.message : String(err)}`,
    );
  });
};
