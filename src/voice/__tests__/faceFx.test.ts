import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeFaceFxOutput } from '../faceFx/lipCore';
import { faceFxDialogueLanguage } from '../faceFx/text';

describe('faceFxDialogueLanguage', () => {
  it('selects Ukrainian when the line has Cyrillic', () => {
    expect(faceFxDialogueLanguage('Привіт, мешканцю.')).toBe('Ukrainian');
    expect(faceFxDialogueLanguage('Pip-Boy працює')).toBe('Ukrainian');
  });

  it('keeps USEnglish for ASCII dialogue', () => {
    expect(faceFxDialogueLanguage('Hello, vault dweller.')).toBe('USEnglish');
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
