/**
 * SCEN (Scene) record extractor for ESP/ESM plugins.
 *
 * Bethesda's SCEN records define scripted conversation sequences with multiple
 * phases and dialog actions. Each scene contains zero or more *actions*, where
 * actions of interest are dialog lines tied to a DIAL topic via a FormID.
 *
 * SCEN record subrecord layout (fields relevant to dialog extraction):
 *
 *   EDID : Editor ID (string, null-terminated)
 *   PNAM : Parent quest FormID (uint32, outside of action blocks)
 *
 *   Action blocks are delimited by ANAM subrecords:
 *     ANAM (size=2) : Start of action block, uint16 action type
 *                     (0 = dialogue, 1 = package, 2 = timer)
 *       ALID (4)   : Actor alias ID (int32)
 *       DATA (4)   : Dialog topic FormID (uint32, dialogue actions only)
 *       SNAM (4)   : Start phase index (uint32)
 *       ENAM (4)   : End phase index (uint32)
 *     ANAM (size=0) : End of action block
 *
 * Only dialogue actions are kept. Package and timer actions carry no topic, and
 * HTID is a head-tracking *alias* id rather than a topic FormID, so neither can
 * stand in for DATA.
 *
 * Actions are sorted by `startPhase` to reconstruct playback order.
 */
import { inflateSync } from 'zlib';
import { log } from '../../logger';
import type { SceneAction, SceneRecord } from '../types';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;
const SUBRECORD_HEADER_SIZE = 6;
const FLAG_COMPRESSED = 0x00040000;
const SCENE_ACTION_DIALOGUE = 0;

/**
 * SCEN-specific extraction from ESP records.
 */
export class EspSceneExtractor {
  private readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  /**
   * Extract all SCEN records that contain dialog actions.
   */
  extractScenes(): SceneRecord[] {
    const tes4DataSize = this.buf.readUInt32LE(4);
    const scenes: SceneRecord[] = [];

    const walkScenes = (start: number, end: number): void => {
      let p = start;
      while (p + RECORD_HEADER_SIZE <= end) {
        const sig = this.buf.toString('ascii', p, p + 4);
        if (sig === 'GRUP') {
          const gsz = this.buf.readUInt32LE(p + 4);
          walkScenes(p + GRUP_HEADER_SIZE, Math.min(p + gsz, end));
          p += gsz;
        } else {
          const dataSize = this.buf.readUInt32LE(p + 4);
          if (sig === 'SCEN') {
            const scene = this.parseSceneRecord(p);
            if (scene && scene.actions.length > 0) scenes.push(scene);
          }
          p += RECORD_HEADER_SIZE + dataSize;
        }
      }
    };

    walkScenes(RECORD_HEADER_SIZE + tes4DataSize, this.buf.length);
    log.debug(`ESP: extracted ${scenes.length} scene(s) with dialog`);
    return scenes;
  }

  /**
   * Parse a single SCEN record into a SceneRecord.
   */
  private parseSceneRecord(recOffset: number): SceneRecord | null {
    const dataSize = this.buf.readUInt32LE(recOffset + 4);
    const flags = this.buf.readUInt32LE(recOffset + 8);
    const formIdRaw = this.buf.readUInt32LE(recOffset + 12);
    const formId = formIdRaw.toString(16).toUpperCase().padStart(8, '0');

    let recordData: Buffer;
    if (flags & FLAG_COMPRESSED) {
      const compDataStart = recOffset + RECORD_HEADER_SIZE;
      const compData = this.buf.subarray(
        compDataStart + 4,
        recOffset + RECORD_HEADER_SIZE + dataSize,
      );
      try {
        recordData = inflateSync(compData);
      } catch {
        return null;
      }
    } else {
      recordData = this.buf.subarray(
        recOffset + RECORD_HEADER_SIZE,
        recOffset + RECORD_HEADER_SIZE + dataSize,
      );
    }

    let edid = '';
    let questFormId: string | null = null;
    const actions: SceneAction[] = [];
    let inAction = false;
    let current: {
      actionType: number;
      aliasId: number | null;
      topicFormId: string | null;
      startPhase: number;
      endPhase: number;
    } | null = null;

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= recordData.length) {
      const subSig = recordData.toString('ascii', pos, pos + 4);
      const subSize = recordData.readUInt16LE(pos + 4);
      const ds = pos + SUBRECORD_HEADER_SIZE;

      if (subSig === 'EDID') {
        edid = recordData.toString('utf8', ds, ds + subSize).replace(/\0/g, '');

        // PNAM outside an action block is the parent quest FormID
      } else if (subSig === 'PNAM' && subSize === 4 && !inAction) {
        const raw = recordData.readUInt32LE(ds);
        if (raw !== 0) questFormId = raw.toString(16).toUpperCase().padStart(8, '0');

        // ANAM with size=2 starts a new action block
      } else if (subSig === 'ANAM' && subSize === 2) {
        current = {
          actionType: recordData.readUInt16LE(ds),
          aliasId: null,
          topicFormId: null,
          startPhase: 0,
          endPhase: 0,
        };
        inAction = true;

        // ANAM with size=0 terminates the current action block
      } else if (subSig === 'ANAM' && subSize === 0 && inAction) {
        if (current?.topicFormId && current.actionType === SCENE_ACTION_DIALOGUE) {
          actions.push({
            actionType: current.actionType,
            aliasId: current.aliasId ?? 0,
            topicFormId: current.topicFormId,
            startPhase: current.startPhase,
            endPhase: current.endPhase,
          });
        }
        current = null;
        inAction = false;

        // Inside an action block: collect actor alias, topic FormID, and phase range
      } else if (inAction && current) {
        if (subSig === 'ALID' && subSize === 4) {
          current.aliasId = recordData.readInt32LE(ds);
        } else if (subSig === 'DATA' && subSize === 4) {
          const raw = recordData.readUInt32LE(ds);
          if (raw !== 0) current.topicFormId = raw.toString(16).toUpperCase().padStart(8, '0');
        } else if (subSig === 'SNAM' && subSize === 4) {
          current.startPhase = recordData.readUInt32LE(ds);
        } else if (subSig === 'ENAM' && subSize === 4) {
          current.endPhase = recordData.readUInt32LE(ds);
        }
      }

      pos += SUBRECORD_HEADER_SIZE + subSize;
    }

    // Sort actions by start phase to reflect in-game playback order
    actions.sort((a, b) => a.startPhase - b.startPhase);
    return { formId, edid, questFormId, actions };
  }
}
