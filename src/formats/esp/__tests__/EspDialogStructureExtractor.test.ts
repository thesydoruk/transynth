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

const uint32Sub = (sig: string, value: number): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(4, 4);
  const data = Buffer.alloc(4);
  data.writeUInt32LE(value >>> 0, 0);
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

  it('ignores 4-byte INDX values that are not quest stage indices', () => {
    const quest = buildRecord('QUST', 0x00000ddd, [
      zstring('EDID', 'BadStages'),
      uint32Sub('INDX', 2214592677),
      uint32Sub('INDX', 100),
    ]);

    const extracted = new EspDialogStructureExtractor(buildPlugin([quest]), false).extract();

    expect(extracted.quests).toEqual([
      {
        formId: '00000DDD',
        edid: 'BadStages',
        name: null,
        stages: [100],
      },
    ]);
  });
});
