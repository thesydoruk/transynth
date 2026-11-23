import { deflateSync } from 'node:zlib';
import { EspActorExtractor } from '../EspActorExtractor';

/**
 * Records are rebuilt around subrecord payloads copied byte for byte from
 * Fallout4.esm, so the test reads what the game ships rather than a layout
 * the reader was written to expect.
 */

const FLAG_COMPRESSED = 0x00040000;

const buildPlugin = (records: Buffer[]): Buffer => {
  const tes4 = Buffer.alloc(24);
  tes4.write('TES4', 0, 4, 'ascii');
  return Buffer.concat([tes4, ...records]);
};

const sub = (sig: string, hex: string): Buffer => {
  const payload = Buffer.from(hex, 'hex');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const zstring = (sig: string, text: string): Buffer =>
  sub(sig, Buffer.from(`${text}\0`, 'utf8').toString('hex'));

const buildRecord = (
  sig: string,
  formId: number,
  subrecords: Buffer[],
  compressed = false,
): Buffer => {
  const data = Buffer.concat(subrecords);
  // A compressed record stores the inflated size, then the zlib stream.
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length, 0);
  const payload = compressed ? Buffer.concat([size, deflateSync(data)]) : data;

  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  header.writeUInt32LE(compressed ? FLAG_COMPRESSED : 0, 8);
  header.writeUInt32LE(formId, 12);
  return Buffer.concat([header, payload]);
};

// NPC_ 00002F1E CompanionPiper: ACBS flags 0xB3 (bit 0 = Female), VTCK → NPCFPiper.
const PIPER_ACBS = 'b30000000000e8030a0000002300000000000000';
const PIPER_VTCK = '8a920100';
// NPC_ 000A7D34 MQ101PlayerSpouseMale: ACBS flags 0x30, VTCK → PlayerVoiceMale01.
const SPOUSE_ACBS = '3000000000000600000000002300000000000000';
const SPOUSE_VTCK = 'f48d0100';

describe('EspActorExtractor', () => {
  it('reads the voice type of an NPC_ from its VTCK subrecord', () => {
    const piper = buildRecord(
      'NPC_',
      0x00002f1e,
      [
        zstring('EDID', 'CompanionPiper'),
        sub('ACBS', PIPER_ACBS),
        sub('VTCK', PIPER_VTCK),
        sub('RNAM', '46370100'),
        sub('FULL', '5d5a0100'),
        sub('DNAM', 'b900320000000100'),
      ],
      true,
    );
    const spouse = buildRecord('NPC_', 0x000a7d34, [
      zstring('EDID', 'MQ101PlayerSpouseMale'),
      sub('ACBS', SPOUSE_ACBS),
      sub('VTCK', SPOUSE_VTCK),
    ]);

    const { actors } = new EspActorExtractor(
      buildPlugin([piper, spouse]),
      true,
    ).extractActorIndex();

    expect(actors).toEqual([
      {
        formId: '00002F1E',
        edid: 'CompanionPiper',
        isFemale: true,
        voiceTypeFormId: '0001928A',
        nameLStringId: 0x00015a5d,
        nameText: null,
      },
      {
        formId: '000A7D34',
        edid: 'MQ101PlayerSpouseMale',
        isFemale: false,
        voiceTypeFormId: '00018DF4',
        nameLStringId: null,
        nameText: null,
      },
    ]);
  });

  it('leaves the voice type empty for an NPC_ that carries no VTCK', () => {
    const record = buildRecord('NPC_', 0x00000abc, [
      zstring('EDID', 'TemplatedRaider'),
      sub('ACBS', SPOUSE_ACBS),
    ]);

    const { actors } = new EspActorExtractor(buildPlugin([record]), true).extractActorIndex();

    expect(actors[0]!.voiceTypeFormId).toBeNull();
  });

  it('reads VTYP records: the name and the Female bit of DNAM', () => {
    // DNAM bit 0 is "Allow Default Dialog", bit 1 is "Female".
    const records = [
      buildRecord('VTYP', 0x0001928a, [zstring('EDID', 'NPCFPiper'), sub('DNAM', '02')]),
      buildRecord('VTYP', 0x00018df7, [zstring('EDID', 'PlayerVoiceFemale01'), sub('DNAM', '03')]),
      buildRecord('VTYP', 0x00018df4, [zstring('EDID', 'PlayerVoiceMale01'), sub('DNAM', '01')]),
    ];

    const { voiceTypes } = new EspActorExtractor(buildPlugin(records), true).extractActorIndex();

    expect(voiceTypes).toEqual([
      { formId: '0001928A', edid: 'NPCFPiper', isFemale: true },
      { formId: '00018DF7', edid: 'PlayerVoiceFemale01', isFemale: true },
      { formId: '00018DF4', edid: 'PlayerVoiceMale01', isFemale: false },
    ]);
  });
});
