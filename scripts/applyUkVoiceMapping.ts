#!/usr/bin/env tsx
/**
 * Apply the curated Ukrainian voice → character mapping.
 *
 * Expects the voice library to already be imported (`npm run voice:import-uk-library`).
 * Resolves proposal placeholders `cv:slot-N` to real `common_voice` library ids in
 * stable order; `opentts:*` ids are used as-is.
 *
 * Usage:
 *   npm run voice:apply-uk-mapping
 *   npm run voice:apply-uk-mapping -- --proposal scripts/ukVoiceMappingProposal.json
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { listUkVoiceLibrary, replaceCharacterUkVoiceLinks } from '../src/voice/ukLibrary';

type Proposal = {
  characterKey: string;
  voiceId: string;
  reason: string;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = await yargs(hideBin(process.argv))
  .scriptName('voice:apply-uk-mapping')
  .option('proposal', {
    type: 'string',
    default: path.join(root, 'scripts/ukVoiceMappingProposal.json'),
    describe: 'Path to mapping proposal JSON',
  })
  .help()
  .parse();

const proposalPath = path.resolve(argv.proposal);
if (!fs.existsSync(proposalPath)) {
  throw new Error(`Proposal not found: ${proposalPath}`);
}

const raw = JSON.parse(fs.readFileSync(proposalPath, 'utf8')) as {
  proposals?: Proposal[];
};
const proposals = raw.proposals ?? [];
if (proposals.length === 0) throw new Error('Proposal has no rows');

const db = openDb();

try {
  const library = await listUkVoiceLibrary(db);
  const byId = new Map(library.map((voice) => [voice.id, voice]));
  const cvVoices = library
    .filter((voice) => voice.source === 'common_voice')
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const slotRe = /^cv:slot-(\d+)$/i;
  const cvNeeded = proposals.filter((row) => slotRe.test(row.voiceId)).length;
  if (cvVoices.length < cvNeeded) {
    throw new Error(
      `Library has ${cvVoices.length} Common Voice clips, proposal needs ${cvNeeded}. ` +
        `Run: npm run voice:import-uk-library -- --max-voices ${cvNeeded}`,
    );
  }

  const links: Array<{ characterKey: string; voiceId: string; reason: string }> = [];
  for (const row of proposals) {
    const slot = row.voiceId.match(slotRe);
    let voiceId = row.voiceId;
    if (slot) {
      const index = Number(slot[1]) - 1;
      const voice = cvVoices[index];
      if (!voice) throw new Error(`No Common Voice clip for ${row.voiceId}`);
      voiceId = voice.id;
    } else if (!byId.has(voiceId)) {
      throw new Error(`Library missing voice id ${voiceId} (for ${row.characterKey})`);
    }
    links.push({ characterKey: row.characterKey, voiceId, reason: row.reason });
  }

  const uniqueVoices = new Set(links.map((link) => link.voiceId));
  if (uniqueVoices.size !== links.length) {
    throw new Error('Resolved mapping assigns the same voice more than once');
  }

  await replaceCharacterUkVoiceLinks(db, links);
  log.info(
    `Applied ${links.length} character → UK voice links (${uniqueVoices.size} unique voices)`,
  );
} finally {
  await closeDb();
}
