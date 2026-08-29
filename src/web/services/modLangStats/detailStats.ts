import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { computeModDetailStats } from './computeStats';
import type { ModDetailStats } from './types';

/** Editor / API stats — live aggregation over records/strings/translations. */
export const getModDetailStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<ModDetailStats> => computeModDetailStats(db, modId, srcLang, targetLang);
