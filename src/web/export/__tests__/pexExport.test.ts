import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../db';
import {
  parsePexBuffer,
  patchPexBuffer,
  serializePexStoredContext,
  writeWString,
} from '../../../formats/pex';
import { exportPatchedPexFiles } from '../index';

const buildPex = (strings: string[], sourceFile = 'DialogScript.psc'): Buffer => {
  const wsize = (s: string) => 2 + Buffer.byteLength(s, 'utf8');
  const totalSize =
    16 +
    wsize(sourceFile) +
    wsize('testuser') +
    wsize('testmachine') +
    2 +
    strings.reduce((acc, s) => acc + wsize(s), 0);
  const buf = Buffer.alloc(totalSize, 0);
  let pos = 0;

  buf.writeUInt32BE(0xfa57c0de, pos);
  pos += 4;
  buf.writeUInt8(3, pos);
  pos += 1;
  buf.writeUInt8(2, pos);
  pos += 1;
  buf.writeUInt16BE(3, pos);
  pos += 2;
  pos += 8;

  for (const part of [sourceFile, 'testuser', 'testmachine']) {
    const chunk = writeWString(part);
    chunk.copy(buf, pos);
    pos += chunk.length;
  }

  buf.writeUInt16BE(strings.length, pos);
  pos += 2;
  for (const value of strings) {
    const chunk = writeWString(value);
    chunk.copy(buf, pos);
    pos += chunk.length;
  }

  return buf;
};

/** Stored import context: the literal used on one decompiled line. */
const usedOn = (text: string) =>
  serializePexStoredContext({
    scriptLabel: 'DialogScript.psc',
    headerSourceFile: 'DialogScript.psc',
    matchLineNumbers: [10],
    contextLines: [{ lineNumber: 10, text, highlight: true }],
  });

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('exportPatchedPexFiles', () => {
  it('exports loose Scripts with translated literals from the database', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pex-export-'));
    tempDirs.push(root);
    const pluginPath = path.join(root, 'MyMod.esp');
    const scriptsDir = path.join(root, 'Scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));
    fs.writeFileSync(path.join(scriptsDir, 'DialogScript.pex'), buildPex(['Hello world']));

    const db = {
      query: async (sql: string) => {
        if (sql.includes("r.signature = 'PEX'")) {
          return {
            rows: [
              {
                path: 'PEX\\DialogScript',
                source_text: 'Hello world',
                context: usedOn('  Debug.MessageBox("Hello world") ; #DEBUG_LINE_NO:5'),
                translation: 'Привіт, світ',
              },
            ],
          };
        }
        return { rows: [] };
      },
    } as unknown as Tx;

    const exported = await exportPatchedPexFiles(db, 1, pluginPath, 'en', 'uk');
    expect(exported).toHaveLength(1);
    expect(exported[0]!.fileName).toBe('Scripts\\DialogScript.pex');

    const parsed = parsePexBuffer(Buffer.from(exported[0]!.contentBase64, 'base64'));
    expect(parsed.strings).toContain('Привіт, світ');
    expect(parsed.strings).not.toContain('Hello world');
  });

  it('keeps a translated literal the script uses as a name, not text', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pex-export-'));
    tempDirs.push(root);
    const pluginPath = path.join(root, 'MyMod.esp');
    fs.mkdirSync(path.join(root, 'Scripts'), { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));
    fs.writeFileSync(
      path.join(root, 'Scripts', 'DialogScript.pex'),
      buildPex(['Done', 'Reset', 'Saved!']),
    );

    const row = (source_text: string, line: string, translation: string) => ({
      path: 'PEX\\DialogScript',
      source_text,
      context: usedOn(line),
      translation,
    });
    const db = {
      query: async () => ({
        rows: [
          row('Done', '  Self.GoToState("Done") ; #DEBUG_LINE_NO:3', 'Готово'),
          row('Reset', '  Self.PlayAnimation("Reset") ; #DEBUG_LINE_NO:4', 'Скинути'),
          row('Saved!', '  Debug.Notification("Saved!") ; #DEBUG_LINE_NO:5', 'Збережено!'),
        ],
      }),
    } as unknown as Tx;

    const exported = await exportPatchedPexFiles(db, 1, pluginPath, 'en', 'uk');
    // parsePexBuffer().strings lists only user-looking text, so read the raw table.
    const raw = Buffer.from(exported[0]!.contentBase64, 'base64').toString('utf8');
    expect(raw).toContain('Збережено!');
    expect(raw).toContain('Done');
    expect(raw).toContain('Reset');
    expect(raw).not.toContain('Готово');
    expect(raw).not.toContain('Скинути');
  });

  it('uses source fallback when no translation row exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pex-export-'));
    tempDirs.push(root);
    const pluginPath = path.join(root, 'MyMod.esp');
    const scriptsDir = path.join(root, 'Scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));
    fs.writeFileSync(path.join(scriptsDir, 'DialogScript.pex'), buildPex(['Hello world']));

    const db = {
      query: async () => ({
        rows: [
          {
            path: 'PEX\\DialogScript',
            source_text: 'Hello world',
            context: null,
            translation: null,
          },
        ],
      }),
    } as unknown as Tx;

    const exported = await exportPatchedPexFiles(db, 1, pluginPath, 'en', 'uk');
    const patched = Buffer.from(exported[0]!.contentBase64, 'base64');
    expect(
      patchPexBuffer(buildPex(['Hello world']), new Map([['Hello world', 'Hello world']])).length,
    ).toBeGreaterThan(0);
    expect(parsePexBuffer(patched).strings).toContain('Hello world');
  });
});
