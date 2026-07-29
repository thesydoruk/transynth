import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  encodeFaceFxDialogueText,
  sanitizeFaceFxDialogueText,
  summarizeFaceFxOutput,
} from '../faceFx';

describe('sanitizeFaceFxDialogueText', () => {
  it('removes bracketed tags that hang the wrapper', () => {
    expect(sanitizeFaceFxDialogueText('[Сарказм] Який розпач.')).toBe('Який розпач.');

    expect(sanitizeFaceFxDialogueText('Ну [Сарказм] звісно')).toBe('Ну звісно');
  });

  it('drops unbalanced brackets and keeps plain dialogue intact', () => {
    expect(sanitizeFaceFxDialogueText('Що це за [ штука?')).toBe('Що це за штука?');

    expect(sanitizeFaceFxDialogueText('Привіт, мешканцю Убезпечища.')).toBe(
      'Привіт, мешканцю Убезпечища.',
    );
  });
});

describe('encodeFaceFxDialogueText', () => {
  it('preserves UTF-8 bytes for Cyrillic dialogue', () => {
    const text = 'Привіт! Це тест українського синтезу.';
    const encoded = encodeFaceFxDialogueText(text);
    expect(Buffer.from(encoded, 'latin1').toString('utf8')).toBe(text);
  });

  it('leaves ASCII unchanged on Windows encoding path', () => {
    const text = 'Hello, vault dweller.';
    const encoded = encodeFaceFxDialogueText(text);
    expect(encoded).toBe(text);
  });
});

describe('summarizeFaceFxOutput', () => {
  it('reports LIP size when file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facefx-'));
    const lipPath = path.join(dir, '00001EFF_1.lip');
    fs.writeFileSync(lipPath, Buffer.alloc(1234));
    expect(summarizeFaceFxOutput('verbose log', '', lipPath)).toBe('LIP 00001EFF_1.lip (1234 B)');
    fs.rmSync(dir, { recursive: true });
  });

  it('extracts failure line from verbose log', () => {
    const log =
      '[FaceFX] Loading...\n[FaceFX] Used text: test\n[FaceFX] Lip generation failed: bad wav';
    expect(summarizeFaceFxOutput(log, '', '/missing.lip')).toBe('Lip generation failed: bad wav');
  });
});
