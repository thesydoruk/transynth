import { parseRecordLocation } from '../recordLocation';

describe('parseRecordLocation', () => {
  it('splits signature and GRUP\\FIELD path', () => {
    expect(parseRecordLocation('INFO', 'INFO\\NAM1')).toEqual({
      grup: 'INFO',
      field: 'NAM1',
    });
  });

  it('uses signature as grup when path is a bare field', () => {
    expect(parseRecordLocation('ARMO', 'FULL')).toEqual({
      grup: 'ARMO',
      field: 'FULL',
    });
  });

  it('derives grup from path when signature is missing', () => {
    expect(parseRecordLocation(null, 'WEAP\\FULL')).toEqual({
      grup: 'WEAP',
      field: 'FULL',
    });
  });

  it('handles MCM paths', () => {
    expect(parseRecordLocation('MCM', 'MCM\\$OptionLabel')).toEqual({
      grup: 'MCM',
      field: '$OptionLabel',
    });
  });

  it('returns nulls for empty input', () => {
    expect(parseRecordLocation(null, null)).toEqual({ grup: null, field: null });
  });

  it('strips Disco msgid from PO path so field is only msgctxt', () => {
    expect(
      parseRecordLocation(
        'DLG',
        `PO\\DialoguesLockitEnglish.po\\Dialogue Text/0xABC::If by 'fun stuff,' you mean alcohol.`,
      ),
    ).toEqual({ grup: 'DLG', field: 'Dialogue Text/0xABC' });
    expect(parseRecordLocation('DLG', 'PO\\Dialogues.po\\Kim Kitsuragi-YARD-1::Hello')).toEqual({
      grup: 'DLG',
      field: 'Kim Kitsuragi-YARD-1',
    });
  });
});
