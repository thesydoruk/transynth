/**
 * Scan uk text_stressed for dictionary heteronyms and flag likely wrong readings.
 *
 *   node --import tsx/esm scripts/auditHeteronymStress.ts [--mod-id N] [--limit 200]
 */
import '../src/loadEnv';
import { createRequire } from 'node:module';
import { applyStressMark, UaStressTrie } from 'ua-word-stress';
import { openDb, closeDb } from '../src/db';
import { STRESS_COMBINING_ACUTE, stripStressMarks } from '../src/voice/stressedTranslation';
import { log } from '../src/logger';

const require = createRequire(import.meta.url);
const WORD_RE = /[\p{L}\p{M}]+(?:['\u2019\u02BC\u2018][\p{L}\p{M}]+)*/gu;
const VOWELS = new Set([...'аеєиіїоуюяАЕЄИІЇОУЮЯ']);
const BOUND = String.raw`(?<![\p{L}\p{M}])`;
const BOUND_END = String.raw`(?![\p{L}\p{M}])`;

type Flag = {
  translationId: number;
  modId: number;
  modName: string;
  word: string;
  chosen: string;
  alt: string;
  reason: string;
  context: string;
};

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

const stressedVowelIndex = (word: string): number | null => {
  const chars = [...word.normalize('NFC')];
  let vi = 0;
  for (let i = 0; i < chars.length; i++) {
    if (!VOWELS.has(chars[i])) continue;
    if (chars[i + 1] === STRESS_COMBINING_ACUTE) return vi;
    vi += 1;
  }
  return null;
};

const has = (ctx: string, re: RegExp): boolean => re.test(ctx);

const pondCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return (
    has(
      t,
      new RegExp(
        `${BOUND}(сяюч|лебед|лебід|вод|риб|пляж|берег|озер|річк|болот|купа|плив|човн|качур|качк|жаб|калюж)`,
        'u',
      ),
    ) || has(t, new RegExp(`${BOUND}(у|в|на|по)${BOUND_END}\\s+[\\p{L}\\p{M}']*ставк`, 'u'))
  );
};

const castleCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(
    t,
    new RegExp(`${BOUND}(старий|руїн|корол|принц|башт|фортец|пагорб|середньовіч|цитадел)`, 'u'),
  );
};

const lockCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(t, new RegExp(`${BOUND}(відчин|замкн|ключ|двер|скринь|защіпк|відмик|відмика)`, 'u'));
};

const flourCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(t, new RegExp(`${BOUND}(міш|печ|хліб|тісто|пшенич|жернов|міси)`, 'u'));
};

const tormentCue = (ctx: string): boolean => {
  const t = ctx.toLocaleLowerCase('uk-UA');
  return has(t, new RegExp(`${BOUND}(біль|страждан|пекл|душе|серц)`, 'u'));
};

const flagHeteronym = (
  plainLower: string,
  chosenIdx: number,
  stresses: readonly number[],
  context: string,
): string | null => {
  if (/^ставк/u.test(plainLower)) {
    const pondIdx = stresses.includes(1) ? 1 : stresses[stresses.length - 1]!;
    const betIdx = stresses.includes(0) ? 0 : stresses[0]!;
    if (pondCue(context) && chosenIdx === betIdx && chosenIdx !== pondIdx) {
      return 'ставок(водойма) vs ставка — за контекстом водойма';
    }
  }
  if (/^замк/u.test(plainLower)) {
    if (lockCue(context) && chosenIdx === 0) return 'замок: контекст замка/ключа';
    if (castleCue(context) && chosenIdx === 1) return 'замок: контекст фортеці';
  }
  if (/^мук/u.test(plainLower)) {
    // му́ка/му́ки = torment (idx 0); мука́/муки́ = flour (idx 1)
    if (flourCue(context) && chosenIdx === 0) return 'мука: контекст борошна, очікується мука́';
    if (tormentCue(context) && chosenIdx === 1) return 'мука: контекст страждання, очікується му́ка';
  }
  if (plainLower === 'ставок' && pondCue(context) && chosenIdx === 0) {
    return 'ставок(водойма): очікується ставо́к';
  }
  return null;
};

/** Content-word families worth mining for the prompt (skip function-word heteronyms). */
const INTERESTING =
  /^(ставк|замк|мук[аиу]|атлас|орган|за́?мок|замок|замок|про́?вод|провод|пар|пара|пару|паром|в́?и́?д|вид[ау]?|захід|схід|об́?ід|обід)/u;

const main = async (): Promise<void> => {
  const { modId, limit } = parseArgs();
  const dataPath = require.resolve('ua-word-stress/data/ua_stress.ctrie.gz');
  const trie = await UaStressTrie.fromFile(dataPath);
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

  const flags: Flag[] = [];
  const byReason = new Map<string, number>();
  const familySamples = new Map<string, Flag[]>();
  let heteronymTokens = 0;

  for (const row of rows) {
    const stressed = row.text_stressed.normalize('NFC');
    WORD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD_RE.exec(stressed)) !== null) {
      const raw = match[0];
      if (!raw.includes(STRESS_COMBINING_ACUTE)) continue;
      const plain = stripStressMarks(raw);
      const key = plain.toLocaleLowerCase('uk-UA');
      const full = trie.lookupFull(key);
      if (!full || full.type !== 'heteronym' || full.stresses.length < 2) continue;
      heteronymTokens += 1;
      const chosenIdx = stressedVowelIndex(raw);
      if (chosenIdx == null) continue;

      const altIdx = full.stresses.find((i) => i !== chosenIdx) ?? full.stresses[0]!;
      const entry: Flag = {
        translationId: row.translation_id,
        modId: row.mod_id,
        modName: row.mod_name,
        word: key,
        chosen: applyStressMark(key, chosenIdx) ?? raw,
        alt: applyStressMark(key, altIdx) ?? key,
        reason: '',
        context: row.text,
      };

      if (INTERESTING.test(key) || /^ставк/u.test(key)) {
        const bucket = key.replace(/(у|а|ом|ів|и|і|ою|ою|ам|ами|ах)$/u, '');
        const list = familySamples.get(bucket) ?? [];
        if (list.length < 30) {
          list.push({ ...entry, reason: `idx=${chosenIdx} primary=${full.stress}` });
          familySamples.set(bucket, list);
        }
      }

      const reason = flagHeteronym(key, chosenIdx, full.stresses, row.text);
      if (!reason) continue;
      flags.push({ ...entry, reason });
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  log.info(`scanned=${rows.length} heteronymTokens=${heteronymTokens} flagged=${flags.length}`);
  console.log(JSON.stringify({ byReason: Object.fromEntries(byReason) }, null, 2));
  console.log('--- flagged ---');
  for (const f of flags.slice(0, limit)) {
    console.log(JSON.stringify(f));
  }
  console.log('--- interesting families ---');
  for (const [family, samples] of [...familySamples.entries()].sort()) {
    console.log(`# ${family} (${samples.length})`);
    for (const s of samples.slice(0, 12)) {
      console.log(
        JSON.stringify({
          id: s.translationId,
          mod: s.modId,
          chosen: s.chosen,
          alt: s.alt,
          meta: s.reason,
          context: s.context,
        }),
      );
    }
  }

  await closeDb();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
