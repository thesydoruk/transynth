import type { SceneAction } from '../../types';
import type { EspRecordLayout } from '../recordLayout';

const toFormIdHex = (raw: number): string | null =>
  raw === 0 ? null : raw.toString(16).toUpperCase().padStart(8, '0');

/** The scene part of a record layout, with its lists turned into sets. */
export type SceneActionLayout = {
  actionKinds: EspRecordLayout['scene']['actionKinds'];
  topicSubrecords: ReadonlySet<string>;
  startSceneSubrecords: ReadonlySet<string>;
  playerTopicSubrecords: ReadonlySet<string>;
};

export const toSceneActionLayout = (scene: EspRecordLayout['scene']): SceneActionLayout => ({
  actionKinds: scene.actionKinds,
  topicSubrecords: new Set(scene.topicSubrecords),
  startSceneSubrecords: new Set(scene.startSceneSubrecords),
  playerTopicSubrecords: new Set(scene.playerTopicSubrecords),
});

/** Mutable action block collected between ANAM start and ANAM end. */
export type SceneActionDraft = {
  actionType: number;
  aliasId: number | null;
  topicFormId: string | null;
  topicFormIds: string[];
  playerTopicFormIds: string[];
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
  playerTopicFormIds: [],
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
 * seconds (FO4/Skyrim/Starfield reuse the signature). `HTID` is a head-track
 * alias, not a topic, and is ignored.
 */
export const applyActionSubrecord = (
  draft: SceneActionDraft,
  subSig: string,
  payload: Buffer,
  layout: SceneActionLayout,
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
  if (layout.startSceneSubrecords.has(subSig) && size === 4) {
    const hex = toFormIdHex(payload.readUInt32LE(0));
    if (hex && draft.startSceneFormId == null) draft.startSceneFormId = hex;
    return;
  }
  if (layout.topicSubrecords.has(subSig) && size === 4) {
    const hex = toFormIdHex(payload.readUInt32LE(0));
    if (!hex) return;
    pushTopic(draft, hex, subSig === 'DATA');
    if (layout.playerTopicSubrecords.has(subSig) && !draft.playerTopicFormIds.includes(hex)) {
      draft.playerTopicFormIds.push(hex);
    }
  }
};

/** Finish an action block; ANAM types the layout does not know are dropped. */
export const finalizeSceneAction = (
  draft: SceneActionDraft,
  layout: SceneActionLayout,
): SceneAction | null => {
  const actionType = layout.actionKinds[draft.actionType];
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
    ...(draft.playerTopicFormIds.length > 0
      ? { playerTopicFormIds: draft.playerTopicFormIds }
      : {}),
  };
};
