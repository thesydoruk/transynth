import type { UkVoiceGender } from '../types';

export type OpenttsVoiceDef = {
  id: string;
  slug: string;
  dataset: string;
  displayName: string;
  gender: UkVoiceGender;
  description: string;
};

/** Studio Ukrainian voices (Apache-2.0 / Kateryna CC-BY-NC — still used as curated refs). */
export const OPENTTS_VOICES: OpenttsVoiceDef[] = [
  {
    id: 'opentts:lada',
    slug: 'lada',
    dataset: 'speech-uk/opentts-lada',
    displayName: 'Lada',
    gender: 'female',
    description: 'High-quality studio female voice (opentts-uk, ~10h).',
  },
  {
    id: 'opentts:tetiana',
    slug: 'tetiana',
    dataset: 'speech-uk/opentts-tetiana',
    displayName: 'Tetiana',
    gender: 'female',
    description: 'High-quality studio female voice (opentts-uk, ~8h).',
  },
  {
    id: 'opentts:kateryna',
    slug: 'kateryna',
    dataset: 'speech-uk/opentts-kateryna',
    displayName: 'Kateryna',
    gender: 'female',
    description: 'High-quality studio female voice (opentts-uk, ~2.5h).',
  },
  {
    id: 'opentts:mykyta',
    slug: 'mykyta',
    dataset: 'speech-uk/opentts-mykyta',
    displayName: 'Mykyta',
    gender: 'male',
    description: 'High-quality studio male voice (opentts-uk, ~8h).',
  },
  {
    id: 'opentts:oleksa',
    slug: 'oleksa',
    dataset: 'speech-uk/opentts-oleksa',
    displayName: 'Oleksa',
    gender: 'male',
    description: 'High-quality studio male voice (opentts-uk, ~6h).',
  },
];
