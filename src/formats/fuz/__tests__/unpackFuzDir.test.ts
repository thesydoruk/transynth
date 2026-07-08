import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unpackFuzDir } from '../unpackFuzDir';
import { writeFuz } from '../fuz';

describe('unpackFuzDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpack-fuz-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts lip and xwm into a sibling _unpacked folder', async () => {
    const srcDir = path.join(tmpDir, 'voice');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, '00001EFF_1.fuz'),
      writeFuz(Buffer.from('LIP'), Buffer.from('XWM')),
    );

    const result = await unpackFuzDir({ srcDir, wav: false });

    expect(result.fuzCount).toBe(1);
    expect(result.extracted).toBe(1);
    expect(result.outDir).toBe(path.join(tmpDir, 'voice_unpacked'));
    expect(fs.readFileSync(path.join(result.outDir, '00001EFF_1.lip'))).toEqual(Buffer.from('LIP'));
    expect(fs.readFileSync(path.join(result.outDir, '00001EFF_1.xwm'))).toEqual(Buffer.from('XWM'));
  });

  it('skips already extracted fuz unless force is set', async () => {
    const srcDir = path.join(tmpDir, 'npc');
    fs.mkdirSync(srcDir, { recursive: true });
    const fuzPath = path.join(srcDir, 'line.fuz');
    fs.writeFileSync(fuzPath, writeFuz(Buffer.from('L1'), Buffer.from('X1')));

    const first = await unpackFuzDir({ srcDir, wav: false });
    fs.writeFileSync(fuzPath, writeFuz(Buffer.from('L2'), Buffer.from('X2')));

    const second = await unpackFuzDir({ srcDir, wav: false });
    expect(second.skipped).toBe(1);
    expect(second.extracted).toBe(0);
    expect(fs.readFileSync(path.join(first.outDir, 'line.lip')).toString()).toBe('L1');

    const third = await unpackFuzDir({ srcDir, wav: false, force: true });
    expect(third.extracted).toBe(1);
    expect(fs.readFileSync(path.join(third.outDir, 'line.lip')).toString()).toBe('L2');
  });
});
