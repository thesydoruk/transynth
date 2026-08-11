/**
 * Scan uk text_stressed for likely wrong heteronym readings.
 *
 *   node --import tsx/esm scripts/auditHeteronymStress.ts [--mod-id N] [--limit 200]
 */
import '../src/loadEnv';
import { createRequire } from 'node:module';
import { UaStressTrie } from 'ua-word-stress';
import { openDb, closeDb } from '../src/db';
import { findHeteronymFlags } from '../src/voice/ukStress/heteronymFlags';
import { log } from '../src/logger';

const require = createRequire(import.meta.url);

const parseArgs = (): { modId: number | null; limit: number } => {
  const argv = process.argv.slice(2);
  let modId: number | null = null;
  let limit = 200;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mod-id') modId = Number(argv[++i]);
    if (argv[i] === '--limit') limit = Number(argv[++i]);
  }
  return { modId, limit };
};

const main = async (): Promise<void> => {
  const { modId, limit } = parseArgs();
  const trie = await UaStressTrie.fromFile(
    require.resolve('ua-word-stress/data/ua_stress.ctrie.gz'),
  );
  const db = openDb();

  const params: unknown[] = ['uk'];
  let where = `t.target_lang = $1
    AND t.text_stressed IS NOT NULL AND btrim(t.text_stressed) <> ''
    AND t.stress_src_text = t.text`;
  if (modId != null && Number.isFinite(modId)) {
    params.push(modId);
    where += ` AND r.mod_id = $${params.length}`;
  }

  const { rows } = await db.query<{
    translation_id: number;
    mod_id: number;
    mod_name: string;
    text: string;
    text_stressed: string;
  }>(
    `SELECT t.id AS translation_id, r.mod_id, m.name AS mod_name, t.text, t.text_stressed
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     WHERE ${where}
     ORDER BY r.mod_id, t.id`,
    params,
  );

  const byReason = new Map<string, number>();
  const samples: Array<{
    id: number;
    mod: string;
    chosen: string;
    correct: string;
    reason: string;
    context: string;
  }> = [];

  for (const row of rows) {
    const flags = findHeteronymFlags(row.text_stressed, row.text, (w) => trie.lookupFull(w));
    for (const f of flags) {
      byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
      if (samples.length < limit) {
        samples.push({
          id: row.translation_id,
          mod: `${row.mod_id}:${row.mod_name}`,
          chosen: f.chosen,
          correct: f.correct,
          reason: f.reason,
          context: row.text,
        });
      }
    }
  }

  log.info(`scanned=${rows.length} flagged=${[...byReason.values()].reduce((a, b) => a + b, 0)}`);
  console.log(JSON.stringify({ byReason: Object.fromEntries(byReason) }, null, 2));
  for (const s of samples) console.log(JSON.stringify(s));

  await closeDb();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
