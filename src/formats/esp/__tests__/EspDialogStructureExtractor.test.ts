import { EspDialogStructureExtractor } from '../EspDialogStructureExtractor';

/** Build a minimal uncompressed plugin buffer with one record. */
const buildPlugin = (records: Buffer[]): Buffer => {
  const tes4 = Buffer.alloc(24);
  tes4.write('TES4', 0, 4, 'ascii');
  tes4.writeUInt32LE(0, 4);
  return Buffer.concat([tes4, ...records]);
};

const buildRecord = (sig: string, formId: number, subrecords: Buffer[]): Buffer => {
  const data = Buffer.concat(subrecords);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(formId, 12);
  return Buffer.concat([header, data]);
};

const zstring = (sig: string, text: string): Buffer => {
  const payload = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const formIdSub = (sig: string, formId: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(4, 4);
  const data = Buffer.alloc(4);
  data.writeUInt32LE(formId, 0);
  return Buffer.concat([header, data]);
};

const uint16Sub = (sig: string, value: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(2, 4);
  const data = Buffer.alloc(2);
  data.writeUInt16LE(value, 0);
  return Buffer.concat([header, data]);
};

/** A subrecord whose payload is given as the hex bytes found in a real plugin. */
const rawSub = (sig: string, hex: string): Buffer => {
  const data = Buffer.from(hex, 'hex');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(data.length, 4);
  return Buffer.concat([header, data]);
};

describe('EspDialogStructureExtractor', () => {
  it('extracts QUST stages, DLBR links, and DIAL ownership', () => {
    const quest = buildRecord('QUST', 0x00000aaa, [
      zstring('EDID', 'TestQuest'),
      zstring('FULL', 'Test Quest Name'),
      uint16Sub('INDX', 10),
      uint16Sub('INDX', 20),
    ]);
    const branch = buildRecord('DLBR', 0x00000bbb, [
      zstring('EDID', 'TestBranch'),
      formIdSub('QNAM', 0x00000aaa),
      formIdSub('SNAM', 0x00000ccc),
    ]);
    const dial = buildRecord('DIAL', 0x00000ccc, [
      zstring('EDID', 'TestTopic'),
      formIdSub('QNAM', 0x00000aaa),
      formIdSub('BNAM', 0x00000bbb),
    ]);

    const extracted = new EspDialogStructureExtractor(
      buildPlugin([quest, branch, dial]),
      false,
    ).extract();

    expect(extracted.quests).toEqual([
      {
        formId: '00000AAA',
        edid: 'TestQuest',
        name: 'Test Quest Name',
        stages: [10, 20],
      },
    ]);
    expect(extracted.branches).toEqual([
      {
        formId: '00000BBB',
        edid: 'TestBranch',
        questFormId: '00000AAA',
        startTopicFormId: '00000CCC',
      },
    ]);
    expect(extracted.dialOwnership).toEqual([
      {
        formId: '00000CCC',
        questFormId: '00000AAA',
        branchFormId: '00000BBB',
      },
    ]);
  });

  it('reads the stage of a 4-byte INDX whatever its flags and unused byte hold', () => {
    // INDX payloads copied from Fallout4.esm: uint16 stage, uint8 flags, and
    // an unused byte the Creation Kit leaves uninitialised.
    const quest = buildRecord('QUST', 0x0001ed86, [
      zstring('EDID', 'MQ101'),
      rawSub('INDX', '0000029b'), // stage 0, Run On Start, unused 0x9B
      rawSub('INDX', '0a00001b'), // stage 10, unused 0x1B
      rawSub('INDX', '11000000'), // stage 17, nothing else set
      rawSub('INDX', '5d0000da'), // stage 93, unused 0xDA (negative as an int32)
      rawSub('INDX', 'e80304be'), // MQ102: stage 1000, Run On Stop, unused 0xBE
    ]);

    const extracted = new EspDialogStructureExtractor(buildPlugin([quest]), true).extract();

    expect(extracted.quests).toEqual([
      {
        formId: '0001ED86',
        edid: 'MQ101',
        name: null,
        stages: [0, 10, 17, 93, 1000],
      },
    ]);
  });

  it('skips an INDX that is neither the 2-byte nor the 4-byte stage form', () => {
    const quest = buildRecord('QUST', 0x00000ddd, [
      zstring('EDID', 'OddStages'),
      rawSub('INDX', '0a'),
      rawSub('INDX', '0a0000000000'),
      uint16Sub('INDX', 100),
    ]);

    const extracted = new EspDialogStructureExtractor(buildPlugin([quest]), false).extract();

    expect(extracted.quests[0]!.stages).toEqual([100]);
  });
});
