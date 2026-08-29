/**
 * SCEN (Scene) record extractor for ESP/ESM plugins.
 *
 * Keeps every recognized action (dialogue, package, timer, and FO4 player
 * dialogue / start-scene / NPC response / radio). Dialogue phases still come
 * from topic-bearing actions; timers and packages are stored so a later pass
 * can tell which scenes are pinned to authored duration.
 */
import { log } from '../../logger';
import type { SceneRecord } from '../types';
import { parseSceneRecord } from './scene/parseSceneRecord';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;

/**
 * Walk a plugin buffer and collect SCEN records that contain at least one
 * recognized action.
 */
export class EspSceneExtractor {
  private readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  /** Extract scenes that have dialogue, timing, or FO4 extra actions. */
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
            const scene = parseSceneRecord(this.buf, p);
            if (scene) scenes.push(scene);
          }
          p += RECORD_HEADER_SIZE + dataSize;
        }
      }
    };

    walkScenes(RECORD_HEADER_SIZE + tes4DataSize, this.buf.length);
    log.debug(`ESP: extracted ${scenes.length} scene(s)`);
    return scenes;
  }
}
