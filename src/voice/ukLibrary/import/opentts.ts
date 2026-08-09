import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { upsertUkVoiceLibraryRow } from '../db';
import { ukVoiceAudioAbsPath, ukVoiceAudioRelPath, ukVoiceSourceDir } from '../paths';
import type { UkVoiceGender, UkVoiceLibraryRow } from '../types';
import { downloadAndNormalizeReferenceClip } from './downloadClip';
import { fetchHfDatasetRows } from './hfRows';

type OpenttsVoice = {
  id: string;
  dataset: string;
  displayName: string;
  gender: UkVoiceGender;
  description: string;
};

const OPENTTS_VOICES: OpenttsVoice[] = [
  {
    id: 'opentts:lada',
    dataset: 'speech-uk/opentts-lada',
    displayName: 'Lada',
    gender: 'female',
    description: 'High-quality studio female voice (opentts-uk, ~10h).',
  },
  {
    id: 'opentts:tetiana',
    dataset: 'speech-uk/opentts-tetiana',
    displayName: 'Tetiana',
    gender: 'female',
    description: 'High-quality studio female voice (opentts-uk, ~8h).',
  },
  {
    id: 'opentts:kateryna',
    dataset: 'speech-uk/opentts-kateryna',
    displayName: 'Kateryna',
    gender: 'female',
    description: 'High-quality studio female voice (opentts-uk, ~2.5h).',
  },
  {
    id: 'opentts:mykyta',
    dataset: 'speech-uk/opentts-mykyta',
    displayName: 'Mykyta',
    gender: 'male',
    description: 'High-quality studio male voice (opentts-uk, ~8h).',
  },
  {
    id: 'opentts:oleksa',
    dataset: 'speech-uk/opentts-oleksa',
    displayName: 'Oleksa',
    gender: 'male',
    description: 'High-quality studio male voice (opentts-uk, ~6h).',
  },
];

const pickReferenceRow = async (dataset: string) => {
  const { rows } = await fetchHfDatasetRows(dataset, 0, 40);
  const scored = rows
    .filter((row) => row.duration != null && row.duration >= 3.5 && row.duration <= 10)
    .sort((a, b) => Math.abs((a.duration ?? 0) - 6) - Math.abs((b.duration ?? 0) - 6));
  return scored[0] ?? rows.find((row) => (row.duration ?? 0) >= 2) ?? rows[0];
};

/** Import one representative clip per opentts studio voice. */
export const importOpenttsVoices = async (db: Tx): Promise<number> => {
  ukVoiceSourceDir('opentts');
  let imported = 0;

  for (const voice of OPENTTS_VOICES) {
    const row = await pickReferenceRow(voice.dataset);
    if (!row) {
      log.warn(`opentts: no usable clip for ${voice.displayName}`);
      continue;
    }

    const fileName = `${voice.id.replace('opentts:', '')}.wav`;
    const rel = ukVoiceAudioRelPath('opentts', fileName);
    const abs = ukVoiceAudioAbsPath(rel);
    await downloadAndNormalizeReferenceClip(row.audioUrl, abs);

    const libraryRow: UkVoiceLibraryRow = {
      id: voice.id,
      source: 'opentts',
      displayName: voice.displayName,
      description: voice.description,
      gender: voice.gender,
      audioRelPath: rel,
      transcript: row.transcription,
      license: 'Apache-2.0',
      durationSec: row.duration,
      meta: { dataset: voice.dataset, rowIdx: row.rowIdx },
    };
    await upsertUkVoiceLibraryRow(db, libraryRow);
    imported += 1;
    log.info(`opentts: imported ${voice.displayName} (${row.duration?.toFixed(1) ?? '?'}s)`);
  }

  return imported;
};
