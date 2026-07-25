import { getSrcLang, getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { DialogGroup, DialogScope, DialogTranscript } from '../types';

const langQuery = (srcLang: string, targetLang: string) =>
  `srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`;

export const dialogsEndpoints = {
  /** Every selectable group of a scope, with translation progress counters. */
  groups: (modId: number, scope: DialogScope, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    req<DialogGroup[]>(
      `/api/dialogs/groups?modId=${modId}&scope=${scope}&${langQuery(srcLang, targetLang)}`,
    ),

  /** Ordered dialog content of one group. */
  transcript: (
    modId: number,
    scope: DialogScope,
    key: string,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) =>
    req<DialogTranscript>(
      `/api/dialogs/transcript?modId=${modId}&scope=${scope}&key=${encodeURIComponent(key)}&${langQuery(srcLang, targetLang)}`,
    ),
};
