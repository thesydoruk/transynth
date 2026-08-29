import { readFuz, writeFuz } from '../fuz';

describe('fuz format', () => {
  it('round-trips lip and xwm payloads', () => {
    const lip = Buffer.from('fresh-lip-data');
    const xwm = Buffer.from('fresh-xwm-data');
    const packed = writeFuz(lip, xwm);
    const parsed = readFuz(packed);
    expect(parsed.lip).toEqual(lip);
    expect(parsed.xwm).toEqual(xwm);
  });

  it('does not embed old lip when packing new data', () => {
    const oldFuz = writeFuz(Buffer.from('old-lip'), Buffer.from('old-xwm'));
    const oldParts = readFuz(oldFuz);

    const newFuz = writeFuz(Buffer.from('new-lip-from-facefx'), Buffer.from('new-xwm'));
    const newParts = readFuz(newFuz);

    expect(newParts.lip.equals(oldParts.lip)).toBe(false);
    expect(newParts.lip.toString()).toBe('new-lip-from-facefx');
  });
});
