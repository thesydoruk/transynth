import { getSrcLang, getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type {
  DialogGroup,
  DialogScope,
  DialogSpeaker,
  DialogTranscript,
  SpeakerGender,
} from '../types';

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

  /** Every speaker of a mod with its detected and overridden gender. */
  speakers: (modId: number) => req<DialogSpeaker[]>(`/api/dialogs/speakers?modId=${modId}`),

  /**
   * Set the gender of one speaker, or clear the override with `null`.
   *
   * The server re-runs QA for every line the speaker takes part in, so the
   * transcript should be refetched afterwards.
   */
  setSpeakerGender: (
    modId: number,
    speakerKey: string,
    gender: SpeakerGender | null,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) =>
    req<DialogSpeaker>(`/api/dialogs/speakers/${encodeURIComponent(speakerKey)}`, {
      method: 'PATCH',
      body: JSON.stringify({ modId, gender, srcLang, targetLang }),
    }),
};
