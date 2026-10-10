import { describe, expect, it } from '@jest/globals';
import { iterCsvRecords, parseCsvRecords } from '../parse';

const HEADER = 'FormID,Signature,EDID,Path,Source,Target,Status';

describe('parseCsvRecords', () => {
  it('reads the columns by name, in any order and any case', () => {
    const csv = ['target,SOURCE,formid', 'Стерджес,Sturges,0001F00A'].join('\n');

    expect(parseCsvRecords(csv)).toEqual([
      {
        formId: '0001F00A',
        signature: '',
        edid: '',
        field: 'FULL',
        source: 'Sturges',
        target: 'Стерджес',
        status: 0xff,
      },
    ]);
  });

  it('maps the status column to the byte the importer stores', () => {
    const csv = [
      HEADER,
      '01,NPC_,A,FULL,One,Один,confirmed',
      '02,NPC_,B,FULL,Two,Два,untranslated',
      '03,NPC_,C,FULL,Three,Три,7',
      '04,NPC_,D,FULL,Four,Чотири,',
    ].join('\n');

    expect(parseCsvRecords(csv).map((r) => r.status)).toEqual([0x63, 0xff, 7, 0xff]);
  });

  it('keeps commas and doubled quotes inside quoted fields', () => {
    const csv = [HEADER, '01,NPC_,A,FULL,"Well, ""friend""","Ну, ""друже""",'].join('\n');

    expect(parseCsvRecords(csv)[0]).toMatchObject({
      source: 'Well, "friend"',
      target: 'Ну, "друже"',
    });
  });

  it('accepts Windows line endings and skips blank lines', () => {
    const csv = `${HEADER}\r\n01,NPC_,A,FULL,One,Один,\r\n\r\n02,NPC_,B,FULL,Two,Два,\r\n`;

    expect(parseCsvRecords(csv).map((r) => r.source)).toEqual(['One', 'Two']);
  });

  // RFC 4180 lets a quoted field span lines; book pages and long dialogue do.
  it('keeps a quoted field that spans several lines in one record', () => {
    const csv = [
      HEADER,
      '01,BOOK,Journal,DESC,"Day one.\nThe raiders came at dawn.","День перший.\nРейдери прийшли на світанку.",confirmed',
      '02,NPC_,B,FULL,Two,Два,',
    ].join('\n');

    const records = parseCsvRecords(csv);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      source: 'Day one.\nThe raiders came at dawn.',
      target: 'День перший.\nРейдери прийшли на світанку.',
      status: 0x63,
    });
    expect(records[1]).toMatchObject({ formId: '02', source: 'Two' });
  });

  it('keeps Windows line breaks inside a quoted field as they were', () => {
    const csv = `${HEADER}\r\n01,BOOK,J,DESC,"Line one.\r\nLine two.",,\r\n`;

    expect(parseCsvRecords(csv)[0]?.source).toBe('Line one.\r\nLine two.');
  });

  it('returns nothing for an empty file or a header alone', () => {
    expect(parseCsvRecords('')).toEqual([]);
    expect(parseCsvRecords(HEADER)).toEqual([]);
  });
});

describe('iterCsvRecords', () => {
  it('yields exactly what parseCsvRecords returns', () => {
    const csv = [
      HEADER,
      '01,BOOK,J,DESC,"Day one.\nDay two.",,confirmed',
      '02,NPC_,B,FULL,"Well, ""friend""",Друже,',
    ].join('\n');

    expect([...iterCsvRecords(csv)]).toEqual(parseCsvRecords(csv));
  });
});
