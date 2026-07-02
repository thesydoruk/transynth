import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';

const MOD_ID = 2;
const LEGENDARY = [
  "Assassin's",
  "Exterminator's",
  "Sentinel's",
  "Ghoul Slayer's",
  "Mutant Slayer's",
  "Poisoner's",
  "Troubleshooter's",
  "Cavalier's",
  "Hunter's",
  "Stalker's",
  'Lucky',
  'VATS Enhanced',
  'Two Shot',
  'Never Ending',
  'Plasma Infused',
  'Incendiary',
  'Explosive',
  'Furious',
  'Instigating',
  'Wounding',
  'Bloodied',
  "Berserker's",
  'Nocturnal',
  'Unyielding',
  'Powered',
  'Chameleon',
  'Bolstering',
  'Fortifying',
  'Vigorous',
  'Sturdy',
  'Deep Pocketed',
  'Pocketed',
  'Lead Lined',
  'Dense',
  'Ultra-Light Build',
  'Jet Pack',
  'BioCommMesh',
  'Tesla Bracers',
  'Glory to Atom!',
  "Sentinel's",
  'Minuteman',
  'Institute',
  'Railroad',
  'Gunner',
];

const NAMES = [
  'Proctor Ingram',
  'High Confessor',
  'Doctor Li',
  'Old Longfellow',
  'Captain Kells',
  'Paladin Brandis',
  'Earl Sterling',
  'Doctor Amari',
  'The Mechanist',
  'Silver Shroud',
  'Roy Brown',
  'Henry Cooke',
  'Sister Gwyneth',
  'Bob Crosby',
  'Signal Interceptor',
  'Acadia',
  'The Fog',
  'Freedom Trail',
  'General Atomics',
  'Radio Freedom',
  'Red Death',
  'Courser Chip',
  'Enclave Soldier',
  'Utility Jumpsuit',
  'The Institute',
  'The Brotherhood',
  'The Railroad',
  'The Commonwealth',
  'Knight',
  'Scribe',
  'Squire',
  'Paladin',
  'Star Paladin',
  'Knight-Sergeant',
  'Gwinnett Brewery',
  'Gwinnett Brand',
  'Nuka-World',
  'Far Harbor Children of Atom',
  'Utility Jumpsuit',
  'Captain Kells',
  'Roy Brown',
  'Bob Crosby',
  'The Fog',
  'General Atomics',
  'Red Death',
  'Personal Intra',
];

const db = openDb();
try {
  console.log('=== LEGENDARY / GAME TERMS ===');
  for (const term of LEGENDARY) {
    const { rows } = await db.query<{ tr: string; cnt: number }>(
      `SELECT trim(t.text) AS tr, COUNT(*)::int AS cnt
       FROM strings s JOIN records r ON r.id=s.record_id
       JOIN translations t ON t.src_string_id=s.id AND t.target_lang='uk'
       WHERE r.mod_id=$1 AND s.lang='en' AND s.text_raw=$2
         AND t.text IS NOT NULL AND trim(t.text)<>''
       GROUP BY trim(t.text) ORDER BY cnt DESC`,
      [MOD_ID, term],
    );
    if (rows.length > 1) {
      console.log(`${term}: ${rows.map((r) => `${r.tr}(${r.cnt})`).join(' | ')}`);
    } else if (rows.length === 1) {
      console.log(`${term}: -> ${rows[0].tr}`);
    }
  }

  console.log('\n=== CHARACTERS / LOCATIONS / FACTION RANKS ===');
  for (const term of NAMES) {
    const { rows } = await db.query<{ tr: string; cnt: number }>(
      `SELECT trim(t.text) AS tr, COUNT(*)::int AS cnt
       FROM strings s JOIN records r ON r.id=s.record_id
       JOIN translations t ON t.src_string_id=s.id AND t.target_lang='uk'
       WHERE r.mod_id=$1 AND s.lang='en' AND s.text_raw=$2
         AND t.text IS NOT NULL AND trim(t.text)<>''
       GROUP BY trim(t.text) ORDER BY cnt DESC LIMIT 4`,
      [MOD_ID, term],
    );
    if (rows.length) {
      const note = rows.length > 1 ? ' CONFLICT' : '';
      console.log(`${term} -> ${rows.map((r) => `${r.tr}(${r.cnt})`).join(' | ')}${note}`);
    }
  }
} finally {
  await closeDb();
}
