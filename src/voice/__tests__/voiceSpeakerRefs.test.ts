import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { PATHS } from '../../paths';
import {
  clearVoiceSpeakerRef,
  loadVoiceSpeakerRefs,
  migrateVoiceSpeakerRefsFromJsonIfNeeded,
  setVoiceSpeakerRef,
  voiceSpeakerRefMatches,
} from '../voiceSpeakerRefs';

type RefRow = {
  speaker_key: string;
  formid_lower6: string;
  variant: number;
  auto_score: number | null;
};

const createMockDb = () => {
  const rows = new Map<string, RefRow>();

  const query = async (sql: string, params: unknown[] = []) => {
    const modId = params[0] as number;
    const speakerKey = params[1] as string | undefined;

    if (sql.includes('DELETE FROM voice_speaker_refs')) {
      rows.delete(`${modId}:${speakerKey}`);
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO voice_speaker_refs')) {
      const key = `${modId}:${params[1] as string}`;
      rows.set(key, {
        speaker_key: params[1] as string,
        formid_lower6: params[2] as string,
        variant: params[3] as number,
        auto_score: (params[4] as number | null) ?? null,
      });
      return { rows: [] };
    }

    if (sql.includes('SELECT speaker_key, formid_lower6, variant')) {
      const out = [...rows.entries()]
        .filter(([key]) => key.startsWith(`${modId}:`))
        .map(([, row]) => row)
        .sort((a, b) => a.speaker_key.localeCompare(b.speaker_key));
      return { rows: out };
    }

    if (sql.includes('SELECT formid_lower6, variant')) {
      const row = rows.get(`${modId}:${speakerKey}`);
      return { rows: row ? [{ formid_lower6: row.formid_lower6, variant: row.variant }] : [] };
    }

    throw new Error(`Unexpected SQL in mock db: ${sql}`);
  };

  return { query } as unknown as Tx;
};

describe('voiceSpeakerRefs', () => {
  const modId = 99_999;
  let db: Tx;
  const jsonPath = path.join(PATHS.voicePreview, String(modId), 'speaker-refs.json');

  beforeEach(() => {
    db = createMockDb();
    fs.rmSync(path.dirname(jsonPath), { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(jsonPath), { recursive: true, force: true });
  });

  it('round-trips speaker reference picks per mod in the database', async () => {
    await setVoiceSpeakerRef(db, modId, 'AlexanderBrown', { formidLower6: '002cba', variant: 4 });
    await expect(loadVoiceSpeakerRefs(db, modId)).resolves.toEqual({
      AlexanderBrown: { formidLower6: '002CBA', variant: 4 },
    });
  });

  it('clears a speaker pick', async () => {
    await setVoiceSpeakerRef(db, modId, 'AlexanderBrown', { formidLower6: '002CBA', variant: 4 });
    await clearVoiceSpeakerRef(db, modId, 'AlexanderBrown');
    await expect(loadVoiceSpeakerRefs(db, modId)).resolves.toEqual({});
  });

  it('matches formid case-insensitively', () => {
    const pick = { formidLower6: '002CBA', variant: 2 };
    expect(voiceSpeakerRefMatches(pick, '002cba', 2)).toBe(true);
    expect(voiceSpeakerRefMatches(pick, '002CBA', 3)).toBe(false);
  });

  it('migrates legacy speaker-refs.json into the database', async () => {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ AlexanderBrown: { formidLower6: '002cba', variant: 4 } }),
      'utf8',
    );

    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
    await expect(loadVoiceSpeakerRefs(db, modId)).resolves.toEqual({
      AlexanderBrown: { formidLower6: '002CBA', variant: 4 },
    });
    expect(fs.existsSync(jsonPath)).toBe(false);
  });

  it('stores picks under voice preview cache path', () => {
    expect(jsonPath).toContain(String(modId));
    expect(jsonPath.startsWith(PATHS.voicePreview)).toBe(true);
  });
});
