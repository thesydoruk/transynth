import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFuz, readFuzLipPeek, readFuzLipSize, writeFuz } from '../fuz';

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

  it('reads lip size from the header without loading the whole file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuz-lip-size-'));
    const file = path.join(dir, 'line.fuz');
    fs.writeFileSync(file, writeFuz(Buffer.from('LIP-BYTES'), Buffer.from('XWM')));
    expect(readFuzLipSize(file)).toBe(9);
    expect(readFuzLipPeek(file).lipVersion).toBe(Buffer.from('LIP-BYTES').readUInt32LE(0));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
