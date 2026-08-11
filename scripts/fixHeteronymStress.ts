/**
 * Auto-correct likely wrong heteronym stresses in uk text_stressed.
 *
 *   node --import tsx/esm scripts/fixHeteronymStress.ts [--dry-run] [--mod-id N]
 */
import '../src/loadEnv';
import { createRequire } from 'node:module';
import { UaStressTrie } from 'ua-word-stress';
import { openDb, closeDb } from '../src/db';
import { stressedMatchesSource } from '../src/voice/stressedTranslation';
import { applyHeteronymFixes, findHeteronymFlags } from '../src/voice/ukStress/heteronymFlags';
import { log } from '../src/logger';

const require = createRequire(import.meta.url);

const parseArgs = (): { modId: number | null; dryRun: boolean } => {
  const argv = process.argv.slice(2);
  let modId: number | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mod-id') modId = Number(argv[++i]);
    if (argv[i] === '--dry-run') dryRun = true;
  }
  return { modId, dryRun };
};

const main = async (): Promise<void> => {
  const { modId, dryRun } = parseArgs();
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
    text: string;
    text_stressed: string;
  }>(
    `SELECT t.id AS translation_id, r.mod_id, t.text, t.text_stressed
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     WHERE ${where}
     ORDER BY t.id`,
    params,
  );

  let fixed = 0;
  let skipped = 0;
  const byReason = new Map<string, number>();

  for (const row of rows) {
    const flags = findHeteronymFlags(row.text_stressed, row.text, (w) => trie.lookupFull(w));
    if (flags.length === 0) continue;
    const next = applyHeteronymFixes(row.text_stressed, flags);
    if (next === row.text_stressed || !stressedMatchesSource(next, row.text)) {
      skipped += 1;
      continue;
    }
    for (const f of flags) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
    if (!dryRun) {
      await db.query(
        `UPDATE translations
            SET text_stressed = $2,
                stress_src_text = text,
                stress_source = 'llm',
                updated_at = NOW()
          WHERE id = $1`,
        [row.translation_id, next],
      );
    }
    fixed += 1;
    if (fixed <= 40) {
      console.log(
        JSON.stringify({
          id: row.translation_id,
          mod: row.mod_id,
          reasons: flags.map((f) => f.reason),
          before: flags.map((f) => f.chosen),
          after: flags.map((f) => f.correct),
          context: row.text,
        }),
      );
    }
  }

  log.info(
    `${dryRun ? '[dry-run] ' : ''}fixedRows=${fixed} skipped=${skipped} byReason=${JSON.stringify(Object.fromEntries(byReason))}`,
  );
  await closeDb();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
