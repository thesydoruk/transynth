import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIfChanged } from '../localizeModWorkspace';

describe('writeIfChanged', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localize-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes when baseline is missing', () => {
    const dest = path.join(tmpDir, 'Strings', 'mod_uk.STRINGS');
    const baseline = path.join(tmpDir, 'extracted', 'Strings', 'mod_uk.STRINGS');
    const data = Buffer.from('localized');

    expect(writeIfChanged(dest, data, baseline)).toBe(true);
    expect(fs.readFileSync(dest)).toEqual(data);
  });

  it('skips when baseline matches', () => {
    const baseline = path.join(tmpDir, 'baseline.esp');
    const dest = path.join(tmpDir, 'localize', 'baseline.esp');
    const data = Buffer.from('same content');
    fs.mkdirSync(path.dirname(baseline), { recursive: true });
    fs.writeFileSync(baseline, data);

    expect(writeIfChanged(dest, data, baseline)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('writes when baseline differs', () => {
    const baseline = path.join(tmpDir, 'baseline.esp');
    const dest = path.join(tmpDir, 'localize', 'baseline.esp');
    fs.mkdirSync(path.dirname(baseline), { recursive: true });
    fs.writeFileSync(baseline, Buffer.from('original'));

    const patched = Buffer.from('patched');
    expect(writeIfChanged(dest, patched, baseline)).toBe(true);
    expect(fs.readFileSync(dest)).toEqual(patched);
  });
});
