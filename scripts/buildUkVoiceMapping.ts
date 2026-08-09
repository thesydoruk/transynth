#!/usr/bin/env tsx
/**
 * Build character → UK voice mapping from the current library (best clips).
 * Writes scripts/ukVoiceMappingProposal.json (+ .md summary). Does not write DB.
 *
 * Usage:
 *   npm run voice:build-uk-mapping
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import {
  buildUkVoiceAutoMap,
  isRobotVoiceFolder,
  listUkVoiceCharacters,
  listUkVoiceLibrary,
  type UkVoiceAutoMapProposal,
} from '../src/voice/ukLibrary';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outJson = path.join(root, 'scripts/ukVoiceMappingProposal.json');
const outMd = path.join(root, 'scripts/ukVoiceMappingProposal.md');

/** Flagship companions keep curated studio voices. */
const HAND_PICKS: Array<{ characterKey: string; voiceId: string; reason: string }> = [
  {
    characterKey: 'NPCFPiper',
    voiceId: 'opentts:lada',
    reason: 'studio Lada; flagship female companion Piper',
  },
  {
    characterKey: 'NPCFCurie',
    voiceId: 'opentts:tetiana',
    reason: 'studio Tetiana; Curie — clear/formal female studio voice',
  },
  {
    characterKey: 'NPCFCait',
    voiceId: 'opentts:kateryna',
    reason: 'studio Kateryna; Cait — major female companion',
  },
  {
    characterKey: 'NPCMNickValentine',
    voiceId: 'opentts:mykyta',
    reason: 'studio Mykyta; Nick Valentine — detective companion',
  },
  {
    characterKey: 'NPCMPrestonGarvey',
    voiceId: 'opentts:oleksa',
    reason: 'studio Oleksa; Preston Garvey — core Minutemen companion',
  },
];

const db = openDb();
try {
  const allCharacters = await listUkVoiceCharacters(db);
  const robots = allCharacters.filter((c) => isRobotVoiceFolder(c.characterKey));
  const mappable = allCharacters.filter((c) => !isRobotVoiceFolder(c.characterKey));
  const library = await listUkVoiceLibrary(db);

  const usedVoiceIds = new Set<string>();
  const handProposals: UkVoiceAutoMapProposal[] = [];
  for (const pick of HAND_PICKS) {
    const character = mappable.find((c) => c.characterKey === pick.characterKey);
    const voice = library.find((v) => v.id === pick.voiceId);
    if (!character || !voice) {
      log.warn(`hand-pick skipped: ${pick.characterKey} → ${pick.voiceId}`);
      continue;
    }
    usedVoiceIds.add(voice.id);
    handProposals.push({
      characterKey: character.characterKey,
      characterGender: character.gender,
      characterAge: character.age,
      displayName: character.displayName,
      modCount: character.modCount,
      voiceId: voice.id,
      voiceName: voice.displayName,
      voiceGender: voice.gender,
      voiceAge: voice.age,
      voiceSource: voice.source,
      reason: `${pick.reason}; F0 ${character.meanF0Hz != null ? `${Math.round(character.meanF0Hz)}Hz` : '?'}→${voice.meanF0Hz != null ? `${Math.round(voice.meanF0Hz)}Hz` : '?'}; age ${character.age}→${voice.age}; Q=${voice.qualityScore ?? '?'}; ${character.lineCount} lines / ${character.modCount} mods`,
    });
  }

  const remainingCharacters = mappable.filter(
    (c) => !handProposals.some((p) => p.characterKey === c.characterKey),
  );
  const remainingVoices = library.filter((v) => !usedVoiceIds.has(v.id));
  const auto = buildUkVoiceAutoMap(remainingCharacters, remainingVoices);
  const proposals = [...handProposals, ...auto].sort((a, b) =>
    a.characterKey.localeCompare(b.characterKey),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    proposals,
    skippedRobots: robots.map((r) => r.characterKey),
  };
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`);

  const lines = [
    `# Ukrainian voice mapping proposal (${proposals.length} characters)`,
    '',
    `- Generated: ${payload.generatedAt}`,
    `- Skipped robots: ${robots.length}`,
    `- Hand-picked opentts: ${handProposals.length}`,
    `- Auto (gender + F0 + age + quality): ${auto.length}`,
    '',
    '## Hand-picked opentts',
    '',
    ...handProposals.map((p) => `- \`${p.characterKey}\` → \`${p.voiceId}\` — ${p.reason}`),
    '',
  ];
  fs.writeFileSync(outMd, `${lines.join('\n')}\n`);
  log.info(`Wrote ${proposals.length} proposals → ${outJson}`);
} finally {
  await closeDb();
}
