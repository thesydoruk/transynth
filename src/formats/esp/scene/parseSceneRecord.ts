/**
 * Parse one SCEN record payload into a SceneRecord.
 *
 * Action blocks are ANAM(size=2) … ANAM(size=0). Quest PNAM is only read
 * outside those blocks. HTID is never treated as a topic.
 */
import { inflateSync } from 'zlib';
import type { SceneAction, SceneRecord } from '../../types';
import {
  applyActionSubrecord,
  finalizeSceneAction,
  startActionDraft,
  type SceneActionDraft,
} from './parseSceneAction';

const RECORD_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;
const FLAG_COMPRESSED = 0x00040000;

const formIdHex = (raw: number): string => raw.toString(16).toUpperCase().padStart(8, '0');

const readRecordPayload = (buf: Buffer, recOffset: number): Buffer | null => {
  const dataSize = buf.readUInt32LE(recOffset + 4);
  const flags = buf.readUInt32LE(recOffset + 8);
  if (flags & FLAG_COMPRESSED) {
    const start = recOffset + RECORD_HEADER_SIZE;
    try {
      return inflateSync(buf.subarray(start + 4, recOffset + RECORD_HEADER_SIZE + dataSize));
    } catch {
      return null;
    }
  }
  return buf.subarray(recOffset + RECORD_HEADER_SIZE, recOffset + RECORD_HEADER_SIZE + dataSize);
};

const flushAction = (draft: SceneActionDraft | null, actions: SceneAction[]): void => {
  if (!draft) return;
  const action = finalizeSceneAction(draft);
  if (action) actions.push(action);
};

/** Parse the SCEN at `recOffset` in a plugin buffer. */
export const parseSceneRecord = (buf: Buffer, recOffset: number): SceneRecord | null => {
  const recordData = readRecordPayload(buf, recOffset);
  if (!recordData) return null;

  const formId = formIdHex(buf.readUInt32LE(recOffset + 12));
  let edid = '';
  let questFormId: string | null = null;
  const actions: SceneAction[] = [];
  let draft: SceneActionDraft | null = null;

  let pos = 0;
  while (pos + SUBRECORD_HEADER_SIZE <= recordData.length) {
    const subSig = recordData.toString('ascii', pos, pos + 4);
    const subSize = recordData.readUInt16LE(pos + 4);
    const payload = recordData.subarray(
      pos + SUBRECORD_HEADER_SIZE,
      pos + SUBRECORD_HEADER_SIZE + subSize,
    );

    if (subSig === 'EDID') {
      edid = payload.toString('utf8').replace(/\0/g, '');
    } else if (subSig === 'PNAM' && subSize === 4 && !draft) {
      const raw = payload.readUInt32LE(0);
      if (raw !== 0) questFormId = formIdHex(raw);
    } else if (subSig === 'ANAM' && subSize === 2) {
      flushAction(draft, actions);
      draft = startActionDraft(payload.readUInt16LE(0));
    } else if (subSig === 'ANAM' && subSize === 0 && draft) {
      flushAction(draft, actions);
      draft = null;
    } else if (draft) {
      applyActionSubrecord(draft, subSig, payload);
    }

    pos += SUBRECORD_HEADER_SIZE + subSize;
  }
  flushAction(draft, actions);

  if (actions.length === 0) return null;
  actions.sort((a, b) => a.startPhase - b.startPhase || a.endPhase - b.endPhase);
  return { formId, edid, questFormId, actions };
};
