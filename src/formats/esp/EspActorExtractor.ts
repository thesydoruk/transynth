/**
 * NPC_ and VTYP record extractor for ESP/ESM plugins.
 *
 * Dialog only records *who* speaks (INFO\ANAM → an actor FormID). The speaker's
 * sex lives on the actor itself, in the ACBS subrecord, and the voice type it
 * points at names the folder its audio ships in. Both are needed to give a
 * translator or a text-to-speech voice the grammatical gender of a line.
 *
 * NPC_ subrecord layout (fields relevant here):
 *
 *   EDID : Editor ID (null-terminated string)
 *   FULL : Name — lstring id (localized) or inline text
 *   ACBS : Configuration, 24 bytes; uint32 flags at offset 0, bit 0 = Female
 *   VTYP : Voice type FormID (uint32)
 *
 * VTYP records contribute their EDID, which is the voice type name (e.g.
 * `FemaleBoston`) that the Creation Kit also uses as the voice folder name, and
 * a DNAM flag byte whose bit 1 marks the voice as female. That flag is the only
 * gender evidence for voice types the name says nothing about — mod-specific
 * names such as `DP_RoxyVoice`, and robots such as `RobotPAM`.
 */
import { log } from '../../logger';
import type { ActorRecord, EspActorIndex, VoiceTypeRecord } from '../types';
import {
  GRUP_HEADER_SIZE,
  RECORD_HEADER_SIZE,
  SUBRECORD_HEADER_SIZE,
  formatFormId,
  readFormIdAt,
  readRecordData,
} from './recordData';

/** Bit 0 of the ACBS flags marks the actor as female. */
const ACBS_FLAG_FEMALE = 0x00000001;

/** Bit 1 of the VTYP DNAM byte marks the voice type as female. */
const VTYP_FLAG_FEMALE = 0x02;

export class EspActorExtractor {
  private readonly buf: Buffer;
  private readonly isLocalized: boolean;

  constructor(buf: Buffer, isLocalized: boolean) {
    this.buf = buf;
    this.isLocalized = isLocalized;
  }

  /** Collect every NPC_ and VTYP record of the plugin in one walk. */
  extractActorIndex(): EspActorIndex {
    const tes4DataSize = this.buf.readUInt32LE(4);
    const actors: ActorRecord[] = [];
    const voiceTypes: VoiceTypeRecord[] = [];

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
        if (sig === 'NPC_') {
          const actor = this.parseActorRecord(p);
          if (actor) actors.push(actor);
        } else if (sig === 'VTYP') {
          const voiceType = this.parseVoiceTypeRecord(p);
          if (voiceType) voiceTypes.push(voiceType);
        }
        p += RECORD_HEADER_SIZE + dataSize;
      }
    };

    walk(RECORD_HEADER_SIZE + tes4DataSize, this.buf.length);
    log.debug(`ESP: extracted ${actors.length} actor(s), ${voiceTypes.length} voice type(s)`);
    return { actors, voiceTypes };
  }

  private parseActorRecord(recOffset: number): ActorRecord | null {
    const data = readRecordData(this.buf, recOffset);
    if (!data) return null;

    const formId = formatFormId(this.buf.readUInt32LE(recOffset + 12));
    const actor: ActorRecord = {
      formId,
      edid: '',
      isFemale: null,
      voiceTypeFormId: null,
      nameLStringId: null,
      nameText: null,
    };

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= data.length) {
      const subSig = data.toString('ascii', pos, pos + 4);
      const subSize = data.readUInt16LE(pos + 4);
      const ds = pos + SUBRECORD_HEADER_SIZE;
      if (ds + subSize > data.length) break;

      if (subSig === 'EDID') {
        actor.edid = data.toString('utf8', ds, ds + subSize).replace(/\0/g, '');
      } else if (subSig === 'ACBS' && subSize >= 4) {
        actor.isFemale = (data.readUInt32LE(ds) & ACBS_FLAG_FEMALE) !== 0;
      } else if (subSig === 'VTYP' && subSize === 4) {
        actor.voiceTypeFormId = readFormIdAt(data, ds);
      } else if (subSig === 'FULL' && subSize > 0) {
        if (this.isLocalized && subSize === 4) {
          const lstringId = data.readUInt32LE(ds);
          if (lstringId !== 0) actor.nameLStringId = lstringId;
        } else {
          const text = data.toString('utf8', ds, ds + subSize).replace(/\0/g, '');
          if (text) actor.nameText = text;
        }
      }

      pos = ds + subSize;
    }

    return actor;
  }

  private parseVoiceTypeRecord(recOffset: number): VoiceTypeRecord | null {
    const data = readRecordData(this.buf, recOffset);
    if (!data) return null;

    const voiceType: VoiceTypeRecord = {
      formId: formatFormId(this.buf.readUInt32LE(recOffset + 12)),
      edid: '',
      isFemale: null,
    };

    let pos = 0;
    while (pos + SUBRECORD_HEADER_SIZE <= data.length) {
      const subSig = data.toString('ascii', pos, pos + 4);
      const subSize = data.readUInt16LE(pos + 4);
      const ds = pos + SUBRECORD_HEADER_SIZE;
      if (ds + subSize > data.length) break;

      if (subSig === 'EDID') {
        voiceType.edid = data.toString('utf8', ds, ds + subSize).replace(/\0/g, '');
      } else if (subSig === 'DNAM' && subSize >= 1) {
        voiceType.isFemale = (data.readUInt8(ds) & VTYP_FLAG_FEMALE) !== 0;
      }

      pos = ds + subSize;
    }

    return voiceType;
  }
}
