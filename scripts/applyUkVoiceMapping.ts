#!/usr/bin/env tsx
/**
 * Apply the curated Ukrainian voice → character mapping.
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

  const links: Array<{ characterKey: string; voiceId: string; reason: string }> = [];
  for (const row of proposals) {
    if (!byId.has(row.voiceId)) {
      throw new Error(`Library missing voice id ${row.voiceId} (for ${row.characterKey})`);
    }
    links.push({
      characterKey: row.characterKey,
      voiceId: row.voiceId,
      reason: row.reason,
    });
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
