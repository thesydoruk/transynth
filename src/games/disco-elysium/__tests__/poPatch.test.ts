import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../../db';
import { parsePoBuffer } from '../../../formats/po';
import { collectDiscoPoPatchEntries, parseDiscoPoRecordPath } from '../export/poPatch';

const SOURCE_PO = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: en_US\\n"

#  Title = WHIRLING F2 / TEQUILA DOOR
#  Actor = You
msgctxt "Dialogue Text/0x01000058000060A0"
msgid "Try to unlock the door."
msgstr "Try to unlock the door."

msgctxt "Dialogue Text/0x010000580000620E_EFFECT"
msgid "N/A"
msgstr " Reputation Grows [Anti-Object Task Force]"
`;

describe('parseDiscoPoRecordPath', () => {
  it('splits file and entry key, keeping the slashes inside the key', () => {
    expect(
      parseDiscoPoRecordPath(
        'PO\\DialoguesEffectsLockitEnglish.po\\Dialogue Text/0x010000580000620E_EFFECT::N/A',
      ),
    ).toEqual({
      relPo: 'DialoguesEffectsLockitEnglish.po',
      entryKey: 'Dialogue Text/0x010000580000620E_EFFECT::N/A',
    });
    expect(parseDiscoPoRecordPath('INFO\\NAM1')).toBeNull();
  });
});

describe('collectDiscoPoPatchEntries', () => {
  it('writes the stored translations into every entry, dummy msgid or not', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-po-patch-'));
    const langDir = path.join(root, 'English_English_en');
    fs.mkdirSync(langDir);
    fs.writeFileSync(path.join(langDir, 'DialoguesLockitEnglish.po'), SOURCE_PO);
    const db = {
      query: async () => ({
        rows: [
          {
            path: 'PO\\DialoguesLockitEnglish.po\\Dialogue Text/0x01000058000060A0::Try to unlock the door.',
            export_text: 'Спробувати відімкнути двері.',
          },
          {
            path: 'PO\\DialoguesLockitEnglish.po\\Dialogue Text/0x010000580000620E_EFFECT::N/A',
            export_text: " Репутація зростає [Антиоб'єктна опергрупа]",
          },
        ],
      }),
    } as unknown as Tx;

    try {
      const entries = await collectDiscoPoPatchEntries(db, 1, root, 'en', 'uk', root);
      expect(entries.map((e) => e.name)).toEqual([
        'Ukrainian_Ukrainian_uk/DialoguesLockitEnglish.po',
      ]);
      const byKey = new Map(parsePoBuffer(entries[0]!.data!).map((e) => [e.key, e.msgstr]));
      expect(byKey.get('Dialogue Text/0x01000058000060A0::Try to unlock the door.')).toBe(
        'Спробувати відімкнути двері.',
      );
      expect(byKey.get('Dialogue Text/0x010000580000620E_EFFECT::N/A')).toBe(
        " Репутація зростає [Антиоб'єктна опергрупа]",
      );
      expect(entries[0]!.data!.toString('utf8')).toContain('# Title = WHIRLING F2 / TEQUILA DOOR');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
