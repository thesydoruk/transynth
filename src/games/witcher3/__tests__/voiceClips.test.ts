import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { buildW3ClipRows, parseW3ClipRelPath, w3ClipRelPath } from '../voice/clips';
import { listW3SpeechFiles, w3SpeechLangFromFileName } from '../packLayout';
import { writeW3Vlq } from '../w3strings';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'w3clips-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** An English container holding rows for `ids` (blocks empty — only the index is read). */
const writeSpeech = (ids: number[], ...dirs: string[]): void => {
  const dir = path.join(root, ...dirs);
  fs.mkdirSync(dir, { recursive: true });
  const head = Buffer.alloc(10);
  head.write('CPSW', 0, 'latin1');
  head.writeUInt32LE(164, 4);
  head.writeUInt16LE(0x4397, 8);
  const rows = Buffer.alloc(ids.length * 40 + 2);
  ids.forEach((id, i) => rows.writeUInt32LE((id ^ 0x79321793) >>> 0, i * 40));
  rows.writeUInt16LE(0x5139, ids.length * 40);
  fs.writeFileSync(
    path.join(dir, 'enpc.w3speech'),
    Buffer.concat([head, writeW3Vlq(ids.length), rows]),
  );
};

describe('voice clips', () => {
  it('names a take by its container and string id, and reads that back', () => {
    writeSpeech([7], 'content', 'content0');
    const [container] = listW3SpeechFiles(root);
    const relPath = w3ClipRelPath(container!, 1185686);
    expect(relPath).toBe('content/content0/enpc.w3speech#1185686');
    expect(parseW3ClipRelPath(relPath)).toEqual({
      container: 'content/content0/enpc.w3speech',
      id: 1185686,
    });
    expect(w3SpeechLangFromFileName('enpc.w3speech')).toBe('en');
    expect(w3SpeechLangFromFileName('en.w3strings')).toBeNull();
  });

  it('links each take to its line, preferring the table in its own folder', () => {
    writeSpeech([10, 20, 30], 'content', 'content0');
    const records = new Map([
      [
        10,
        [
          { recordId: 1, stringId: 101, contentDir: 'dlc/ep1/content' },
          { recordId: 2, stringId: 102, contentDir: 'content/content0' },
        ],
      ],
      [20, [{ recordId: 3, stringId: 103, contentDir: 'dlc/ep1/content' }]],
    ]);
    const rows = buildW3ClipRows(listW3SpeechFiles(root), records);
    expect(rows.map((r) => [r.lineKey, r.recordId, r.stringId])).toEqual([
      ['10', 2, 102],
      ['20', 3, 103],
      ['30', null, null],
    ]);
    expect(rows[0]!.container).toBe('content/content0/enpc.w3speech');
  });
});

describe('speaker names', () => {
  it('title-cases voice tags', async () => {
    const { w3SpeakerDisplayName } = await import('../voice/speakers');
    expect(w3SpeakerDisplayName('TOUSSAINT ARMOURER 01')).toBe('Toussaint Armourer 01');
    expect(w3SpeakerDisplayName("GAUNTER O'DIMM")).toBe("Gaunter O'Dimm");
    expect(w3SpeakerDisplayName('GERALT')).toBe('Geralt');
  });
});
