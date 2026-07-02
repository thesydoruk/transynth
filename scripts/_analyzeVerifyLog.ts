/**
 * Parse verify:auto log output and summarize issues for prompt/glossary tuning.
 *
 * Usage: npx tsx scripts/_analyzeVerifyLog.ts <log-or-terminal-file>
 */
import { readFileSync } from 'fs';

const logPath = process.argv[2];
if (!logPath) {
  console.error('Usage: npx tsx scripts/_analyzeVerifyLog.ts <log-file>');
  process.exit(1);
}

const text = readFileSync(logPath, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');

type IssueRow = {
  action: string;
  verdict: string;
  stringId: number;
  location: string;
  confidence: number;
  reason: string;
  was: string;
  fix?: string;
};

const issues: IssueRow[] = [];
let lastProgress: Record<string, number> | null = null;

const lines = text.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;

  const progress = line.match(
    /Verify: (\d+)\/(\d+) \([^)]+\), approved=(\d+), fixed=(\d+), suspicious=(\d+), incorrect=(\d+), errors=(\d+)/,
  );
  if (progress) {
    lastProgress = {
      done: Number(progress[1]),
      total: Number(progress[2]),
      approved: Number(progress[3]),
      fixed: Number(progress[4]),
      suspicious: Number(progress[5]),
      incorrect: Number(progress[6]),
      errors: Number(progress[7]),
    };
  }

  const header = line.match(
    /(?:Flagged \(fix rejected\)|Fixed|Flagged) \[(ok|suspicious|incorrect)\] string_id=(\d+) ([^\n(]+) \(conf=([0-9.]+)\)/,
  );
  if (!header) continue;

  const action = line.includes('Flagged (fix rejected)')
    ? 'Flagged (fix rejected)'
    : line.includes('Fixed')
      ? 'Fixed'
      : 'Flagged';

  let reason = '';
  let was = '';
  let fix: string | undefined;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    const next = lines[j]!.trim();
    if (/^reason:/.test(next)) reason = next.replace(/^reason:\s*/, '');
    else if (/^was:/.test(next)) was = next.replace(/^was:\s*/, '');
    else if (/^fix:/.test(next)) fix = next.replace(/^fix:\s*/, '');
    else if (/^\d{4}-\d{2}-\d{2}T/.test(next) || /Verify:/.test(next)) break;
  }

  issues.push({
    action,
    verdict: header[1],
    stringId: Number(header[2]),
    location: header[3].trim(),
    confidence: Number(header[4]),
    reason,
    was,
    fix,
  });
}

const bucketReason = (reason: string): string => {
  if (/Protected token mismatch/i.test(reason)) return 'token_mismatch';
  if (/template|шаблон|сері|\[\$OWNER\]/i.test(reason)) return 'series_template';
  if (/glossary|глосар/i.test(reason)) return 'glossary';
  if (/русизм|russism/i.test(reason)) return 'russism';
  if (/калька|calque/i.test(reason)) return 'calque';
  if (/омонім|homonym/i.test(reason)) return 'homonym';
  if (/TM\/EDID|TM\/edid/i.test(reason)) return 'tm_edid';
  if (/legendary|афікс|affix/i.test(reason)) return 'legendary_affix';
  if (/OMOD|модиф|slot|слот|PropMod/i.test(reason)) return 'omod_weap_mod';
  if (/RACE|FMRN|morph|морф/i.test(reason)) return 'race_morph';
  if (/Railroad|Підземк|faction|фракц|Institute|Minuteman|Brotherhood/i.test(reason))
    return 'faction';
  if (/No different fix|No actionable fix/i.test(reason)) return 'noop_suggestion';
  if (/Latin token|npc|\bRNG\b/i.test(reason)) return 'latin_abbr';
  if (/розлог|лакон|стисл|verbose/i.test(reason)) return 'verbosity';
  if (/Pip-?boy|Піп-?бой/i.test(reason)) return 'pipboy_ui';
  if (/Sandman|трансліт|Latin/i.test(reason)) return 'proper_noun';
  return 'other';
};

const reasonBuckets = new Map<string, number>();
const reasonSamples = new Map<string, IssueRow[]>();

for (const issue of issues) {
  const bucket = bucketReason(issue.reason);
  reasonBuckets.set(bucket, (reasonBuckets.get(bucket) ?? 0) + 1);
  const samples = reasonSamples.get(bucket) ?? [];
  if (samples.length < 5) samples.push(issue);
  reasonSamples.set(bucket, samples);
}

console.log(
  JSON.stringify(
    {
      logPath,
      progress: lastProgress,
      pct: lastProgress ? ((lastProgress.done / lastProgress.total) * 100).toFixed(2) + '%' : null,
      issueCount: issues.length,
      byAction: {
        flagged: issues.filter((i) => i.action === 'Flagged').length,
        fixed: issues.filter((i) => i.action === 'Fixed').length,
        fixRejected: issues.filter((i) => i.action === 'Flagged (fix rejected)').length,
      },
      reasonBuckets: Object.fromEntries([...reasonBuckets.entries()].sort((a, b) => b[1] - a[1])),
      samples: Object.fromEntries(
        [...reasonSamples.entries()].map(([k, rows]) => [
          k,
          rows.map((r) => ({
            id: r.stringId,
            loc: r.location,
            action: r.action,
            verdict: r.verdict,
            reason: r.reason.slice(0, 220),
            was: r.was.slice(0, 100),
            fix: r.fix?.slice(0, 100),
          })),
        ]),
      ),
    },
    null,
    2,
  ),
);
