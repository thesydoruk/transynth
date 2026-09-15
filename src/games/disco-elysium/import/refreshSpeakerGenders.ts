/**
 * Put a gender on Disco speakers, read out of the game's own English text.
 *
 * Import names every speaker from the `.wav` stem beside a `.po` entry, but a
 * stem says nothing about gender, so they all land as `unknown` — and Ukrainian
 * needs it on every past-tense verb the character speaks about themselves.
 * There is no voice-type table to consult the way a Bethesda plugin has, and no
 * list of names would cover a cast this invented, so the evidence comes from
 * how the rest of the catalogue writes about them: occurrences of the name with
 * a gendered pronoun close by.
 *
 * Only `detected_gender` is written, so a gender set by hand in the speakers
 * editor keeps winning.
 */
import type { Tx } from '../../../db';
import type { DialogSpeakerRefresh, DialogSpeakerRefreshContext } from '../../contract';
import { collectPronounEvidence } from '../../../dialog';

type SpeakerRow = { speaker_key: string; line_count: number };

/** English source text of the whole mod — the corpus the evidence is counted in. */
const loadEnglishTexts = async (db: Tx, modId: number): Promise<string[]> => {
  const { rows } = await db.query<{ text_raw: string }>(
    `SELECT s.text_raw
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1 AND s.lang = 'en'`,
    [modId],
  );
  return rows.map((row) => row.text_raw);
};

const loadSpeakers = async (db: Tx, modId: number): Promise<SpeakerRow[]> => {
  const { rows } = await db.query<SpeakerRow>(
    `SELECT speaker_key, line_count
       FROM dialog_speakers
      WHERE mod_id = $1
      ORDER BY line_count DESC`,
    [modId],
  );
  return rows;
};

export const refreshDiscoSpeakerGenders = async ({
  db,
  modId,
  dryRun,
}: DialogSpeakerRefreshContext): Promise<DialogSpeakerRefresh> => {
  const speakers = await loadSpeakers(db, modId);
  if (speakers.length === 0) {
    return { actors: 0, speakers: 0, withGender: 0, recoveredSpeakers: 0 };
  }

  const texts = await loadEnglishTexts(db, modId);
  const resolved: Array<{ key: string; gender: string }> = [];
  for (const speaker of speakers) {
    const evidence = collectPronounEvidence(speaker.speaker_key, texts);
    if (evidence.gender === 'male' || evidence.gender === 'female') {
      resolved.push({ key: speaker.speaker_key, gender: evidence.gender });
    }
  }

  if (!dryRun && resolved.length > 0) {
    await db.query(
      `UPDATE dialog_speakers sp
          SET detected_gender = v.gender, detected_source = 'pronoun_evidence', updated_at = NOW()
         FROM (SELECT unnest($2::text[]) AS speaker_key, unnest($3::text[]) AS gender) v
        WHERE sp.mod_id = $1 AND sp.speaker_key = v.speaker_key`,
      [modId, resolved.map((r) => r.key), resolved.map((r) => r.gender)],
    );
  }

  return {
    actors: texts.length,
    speakers: speakers.length,
    withGender: resolved.length,
    recoveredSpeakers: 0,
  };
};
