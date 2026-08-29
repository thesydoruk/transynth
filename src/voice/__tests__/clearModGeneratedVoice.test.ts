import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import type { Tx } from '../../db';
import { clearModGeneratedVoice, clearModLocalizedVoiceFiles } from '../clearModGeneratedVoice';

const writeVoice = (root: string, rel: string): string => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  return abs;
};

describe('clearModLocalizedVoiceFiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-mod-voice-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes Bethesda fuz and Disco wav, leaving other files', () => {
    const keep = writeVoice(root, 'Strings/Fallout4_uk.STRINGS');
    const fuz = writeVoice(root, 'Sound/Voice/Fallout4.esm/MaleBoston/00011111_1.fuz');
    const wav = writeVoice(root, 'Audio/Characters/Kim/line.wav');

    expect(clearModLocalizedVoiceFiles(root)).toBe(2);
    expect(fs.existsSync(fuz)).toBe(false);
    expect(fs.existsSync(wav)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
  });

  it('limits a speaker wipe to that folder', () => {
    const male = writeVoice(root, 'Sound/Voice/Fallout4.esm/MaleBoston/00011111_1.fuz');
    const nora = writeVoice(root, 'Sound/Voice/Fallout4.esm/PlayerVoiceFemale01/00005825_1.fuz');

    expect(clearModLocalizedVoiceFiles(root, 'MaleBoston')).toBe(1);
    expect(fs.existsSync(male)).toBe(false);
    expect(fs.existsSync(nora)).toBe(true);
  });
});

describe('clearModGeneratedVoice', () => {
  it('deletes matching synthesis rows for the mod and language', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-mod-voice-db-'));
    writeVoice(root, 'Sound/Voice/Fallout4.esm/MaleBoston/00011111_1.fuz');
    const query = jest.fn(async () => ({ rowCount: 4, rows: [] }));
    const db = { query } as unknown as Tx;

    const result = await clearModGeneratedVoice(db, {
      modId: 33,
      targetLang: 'UK',
      localizeDir: root,
    });

    expect(result.filesRemoved).toBe(1);
    expect(result.dbRowsRemoved).toBe(4);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM voice_synthesis_state'),
      [33, 'uk'],
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});
