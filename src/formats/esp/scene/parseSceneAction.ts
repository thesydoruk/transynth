import type { SceneAction } from '../../types';
import { SCENE_ACTION_KIND_BY_CODE, SCENE_TOPIC_SUBRECORDS } from './actionTypes';

const toFormIdHex = (raw: number): string | null =>
  raw === 0 ? null : raw.toString(16).toUpperCase().padStart(8, '0');

/** Mutable action block collected between ANAM start and ANAM end. */
export type SceneActionDraft = {
  actionType: number;
  aliasId: number | null;
  topicFormId: string | null;
  topicFormIds: string[];
  startPhase: number;
  endPhase: number;
  sawStartPhase: boolean;
  timerMinSeconds: number | null;
  timerMaxSeconds: number | null;
  loopMin: number | null;
  loopMax: number | null;
  flags: number;
  startSceneFormId: string | null;
};

/** Open a new action block from an ANAM type word. */
export const startActionDraft = (actionType: number): SceneActionDraft => ({
  actionType,
  aliasId: null,
  topicFormId: null,
  topicFormIds: [],
  startPhase: 0,
  endPhase: 0,
  sawStartPhase: false,
  timerMinSeconds: null,
  timerMaxSeconds: null,
  loopMin: null,
  loopMax: null,
  flags: 0,
  startSceneFormId: null,
});

const pushTopic = (draft: SceneActionDraft, hex: string, asPrimary: boolean): void => {
  if (!draft.topicFormIds.includes(hex)) draft.topicFormIds.push(hex);
  if (asPrimary || draft.topicFormId == null) draft.topicFormId = hex;
};

/**
 * Fold one subrecord into the current action.
 *
 * The first 4-byte `SNAM` is the start phase; a later `SNAM` is timer-max
 * seconds (FO4/Skyrim reuse the signature). `HTID` is a head-track alias, not
 * a topic, and is ignored.
 */
export const applyActionSubrecord = (
  draft: SceneActionDraft,
  subSig: string,
  payload: Buffer,
): void => {
  const size = payload.length;
  if (subSig === 'ALID' && size === 4) {
    draft.aliasId = payload.readInt32LE(0);
    return;
  }
  if (subSig === 'FNAM' && size === 4) {
    draft.flags = payload.readUInt32LE(0);
    return;
  }
  if (subSig === 'SNAM' && size === 4) {
    if (!draft.sawStartPhase) {
      draft.startPhase = payload.readUInt32LE(0);
      draft.sawStartPhase = true;
    } else {
      draft.timerMaxSeconds = payload.readFloatLE(0);
    }
    return;
  }
  if (subSig === 'ENAM' && size === 4) {
    draft.endPhase = payload.readUInt32LE(0);
    return;
  }
  if (subSig === 'TNAM' && size === 4) {
    draft.timerMinSeconds = payload.readFloatLE(0);
    return;
  }
  if (subSig === 'DMIN' && size === 4) {
    draft.loopMin = payload.readFloatLE(0);
    return;
  }
  if (subSig === 'DMAX' && size === 4) {
    draft.loopMax = payload.readFloatLE(0);
    return;
  }
  if (subSig === 'LCEP' && size === 4) {
    const hex = toFormIdHex(payload.readUInt32LE(0));
    if (hex && draft.startSceneFormId == null) draft.startSceneFormId = hex;
    return;
  }
  if (SCENE_TOPIC_SUBRECORDS.has(subSig) && size === 4) {
    const hex = toFormIdHex(payload.readUInt32LE(0));
    if (hex) pushTopic(draft, hex, subSig === 'DATA');
  }
};

/** Finish an action block; unknown ANAM types are dropped. */
export const finalizeSceneAction = (draft: SceneActionDraft): SceneAction | null => {
  const actionType = SCENE_ACTION_KIND_BY_CODE[draft.actionType];
  if (!actionType) return null;
  return {
    actionType,
    aliasId: draft.aliasId ?? 0,
    topicFormId: draft.topicFormId,
    topicFormIds: draft.topicFormIds,
    startPhase: draft.startPhase,
    endPhase: draft.endPhase,
    timerMinSeconds: draft.timerMinSeconds,
    timerMaxSeconds: draft.timerMaxSeconds,
    loopMin: draft.loopMin,
    loopMax: draft.loopMax,
    flags: draft.flags,
    startSceneFormId: draft.startSceneFormId,
  };
};
