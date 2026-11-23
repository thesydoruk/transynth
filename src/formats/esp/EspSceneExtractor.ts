/**
 * SCEN (Scene) record extractor for ESP/ESM plugins.
 *
 * Keeps every action the title's record layout knows (dialogue, package,
 * timer, and FO4 player dialogue / start-scene / NPC response / radio, or
 * their Starfield counterparts). Dialogue phases still come from topic-bearing
 * actions; timers and packages are stored so a later pass can tell which
 * scenes are pinned to authored duration. Action types the layout does not
 * list — Starfield's move, camera, FX, animation and timeline actions — are
 * dropped rather than read as something they are not.
 */
import { log } from '../../logger';
import type { SceneRecord } from '../types';
import { DEFAULT_ESP_RECORD_LAYOUT, type EspRecordLayout } from './recordLayout';
import { toSceneActionLayout, type SceneActionLayout } from './scene/parseSceneAction';
import { parseSceneRecord } from './scene/parseSceneRecord';

const RECORD_HEADER_SIZE = 24;
const GRUP_HEADER_SIZE = 24;

/**
 * Walk a plugin buffer and collect SCEN records that contain at least one
 * recognized action.
 */
export class EspSceneExtractor {
  private readonly buf: Buffer;
  private readonly layout: SceneActionLayout;

  constructor(buf: Buffer, layout: EspRecordLayout = DEFAULT_ESP_RECORD_LAYOUT) {
    this.buf = buf;
    this.layout = toSceneActionLayout(layout.scene);
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
            const scene = parseSceneRecord(this.buf, p, this.layout);
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
