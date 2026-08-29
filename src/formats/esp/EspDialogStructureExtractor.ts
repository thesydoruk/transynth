/**
 * Extract QUST, DLBR, and DIAL ownership links for dialog structure browsing.
 *
 * Layout used here (Fallout 4 / Skyrim SE):
 *
 *   QUST: EDID, FULL (inline name when not localized), INDX stage markers
 *   DLBR: EDID, QNAM parent quest, SNAM start DIAL topic
 *   DIAL: QNAM owning quest, BNAM owning DLBR branch
 *
 * Localized FULL values are skipped — EDID is enough to label a quest until
 * string tables are resolved elsewhere.
 */
import { log } from '../../logger';
import type { BranchRecord, DialOwnership, QuestRecord } from '../types';
import {
  GRUP_HEADER_SIZE,
  RECORD_HEADER_SIZE,
  SUBRECORD_HEADER_SIZE,
  formatFormId,
  readFormIdAt,
  readRecordData,
} from './recordData';

export type DialogStructureExtract = {
  quests: QuestRecord[];
  branches: BranchRecord[];
  dialOwnership: DialOwnership[];
};

export class EspDialogStructureExtractor {
  private readonly buf: Buffer;
  private readonly isLocalized: boolean;

  constructor(buf: Buffer, isLocalized: boolean) {
    this.buf = buf;
    this.isLocalized = isLocalized;
  }

  /** Walk the plugin once and collect every quest, branch, and DIAL link. */
  extract(): DialogStructureExtract {
    const quests: QuestRecord[] = [];
    const branches: BranchRecord[] = [];
    const dialOwnership: DialOwnership[] = [];

    const walk = (start: number, end: number): void => {
      let p = start;
      while (p + RECORD_HEADER_SIZE <= end) {
        const sig = this.buf.toString('ascii', p, p + 4);
        if (sig === 'GRUP') {
          const groupSize = this.buf.readUInt32LE(p + 4);
          if (groupSize <= 0) break;
          walk(p + GRUP_HEADER_SIZE, Math.min(p + groupSize, end));
          p += groupSize;
          continue;
        }

        const dataSize = this.buf.readUInt32LE(p + 4);
        if (sig === 'QUST') {
          const quest = this.parseQuest(p);
          if (quest) quests.push(quest);
        } else if (sig === 'DLBR') {
          const branch = this.parseBranch(p);
          if (branch) branches.push(branch);
        } else if (sig === 'DIAL') {
          const ownership = this.parseDialOwnership(p);
          if (ownership && (ownership.questFormId || ownership.branchFormId)) {
            dialOwnership.push(ownership);
          }
        }
        p += RECORD_HEADER_SIZE + dataSize;
      }
    };

    const tes4DataSize = this.buf.readUInt32LE(4);
    walk(RECORD_HEADER_SIZE + tes4DataSize, this.buf.length);
    log.debug(
      `ESP: structure — ${quests.length} quest(s), ${branches.length} branch(es), ` +
        `${dialOwnership.length} dial ownership link(s)`,
    );
    return { quests, branches, dialOwnership };
  }

  private parseQuest(recOffset: number): QuestRecord | null {
    const data = readRecordData(this.buf, recOffset);
    if (!data) return null;

    let edid = '';
    let name: string | null = null;
    const stageSet = new Set<number>();

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= data.length) {
      const subSig = data.toString('ascii', pos, pos + 4);
      const subSize = data.readUInt16LE(pos + 4);
      const ds = pos + SUBRECORD_HEADER_SIZE;
      if (ds + subSize > data.length) break;

      if (subSig === 'EDID') {
        edid = data.toString('utf8', ds, ds + subSize).replace(/\0/g, '');
      } else if (subSig === 'FULL' && subSize > 0 && !(this.isLocalized && subSize === 4)) {
        const text = data.toString('utf8', ds, ds + subSize).replace(/\0/g, '');
        if (text) name = text;
      } else if (subSig === 'INDX' && (subSize === 2 || subSize === 4)) {
        const stageIndex = subSize === 2 ? data.readUInt16LE(ds) : data.readInt32LE(ds);
        // Some QUST subrecords reuse INDX with 4-byte payloads that are not stage
        // numbers (they look like FormIDs). Real quest stages stay small.
        if (stageIndex >= 0 && stageIndex <= 65535) {
          stageSet.add(stageIndex);
        }
      }

      pos = ds + subSize;
    }

    return {
      formId: formatFormId(this.buf.readUInt32LE(recOffset + 12)),
      edid,
      name,
      stages: [...stageSet].sort((a, b) => a - b),
    };
  }

  private parseBranch(recOffset: number): BranchRecord | null {
    const data = readRecordData(this.buf, recOffset);
    if (!data) return null;

    let edid = '';
    let questFormId: string | null = null;
    let startTopicFormId: string | null = null;

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= data.length) {
      const subSig = data.toString('ascii', pos, pos + 4);
      const subSize = data.readUInt16LE(pos + 4);
      const ds = pos + SUBRECORD_HEADER_SIZE;
      if (ds + subSize > data.length) break;

      if (subSig === 'EDID') {
        edid = data.toString('utf8', ds, ds + subSize).replace(/\0/g, '');
      } else if (subSig === 'QNAM' && subSize === 4) {
        questFormId = readFormIdAt(data, ds);
      } else if (subSig === 'SNAM' && subSize === 4) {
        startTopicFormId = readFormIdAt(data, ds);
      }

      pos = ds + subSize;
    }

    return {
      formId: formatFormId(this.buf.readUInt32LE(recOffset + 12)),
      edid,
      questFormId,
      startTopicFormId,
    };
  }

  private parseDialOwnership(recOffset: number): DialOwnership | null {
    const data = readRecordData(this.buf, recOffset);
    if (!data) return null;

    let questFormId: string | null = null;
    let branchFormId: string | null = null;

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= data.length) {
      const subSig = data.toString('ascii', pos, pos + 4);
      const subSize = data.readUInt16LE(pos + 4);
      const ds = pos + SUBRECORD_HEADER_SIZE;
      if (ds + subSize > data.length) break;

      if (subSig === 'QNAM' && subSize === 4) questFormId = readFormIdAt(data, ds);
      else if (subSig === 'BNAM' && subSize === 4) branchFormId = readFormIdAt(data, ds);

      pos = ds + subSize;
    }

    return {
      formId: formatFormId(this.buf.readUInt32LE(recOffset + 12)),
      questFormId,
      branchFormId,
    };
  }
}
