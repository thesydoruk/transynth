/**
 * Dialogue for review, read through the same transcripts the Dialogs tab shows.
 *
 * A dialogue line only makes sense next to the one before and after it, so a
 * unit is a whole conversation: every scene of a quest in phase order, then
 * branches, then topic trees not already covered. Each line lands in exactly
 * one unit — the first, widest one that contains it.
 */
import type { Tx } from '../db';
import {
  getDialogTranscript,
  listDialogGroups,
  type DialogEntryRow,
  type DialogScope,
  type DialogTranscriptRow,
} from '../web/data/queries/dialogs';
import type { ReviewLine, ReviewUnit } from './types';

/** Statuses an editor does not review: removed, refused, or deliberately left untranslated. */
export const UNREVIEWABLE_STATUSES = new Set(['skip', 'deleted', 'rejected']);

const SCOPES: readonly { scope: DialogScope; kind: ReviewUnit['kind'] }[] = [
  { scope: 'conversations', kind: 'conversation' },
  { scope: 'branches', kind: 'branch' },
  { scope: 'topics', kind: 'topic' },
];

export type DialogUnitOptions = {
  srcLang: string;
  targetLang: string;
  /** Provenances shown as `context_only`: text already reviewed elsewhere. */
  contextProvenances?: ReadonlySet<string>;
  onProgress?: (scope: DialogScope, done: number, total: number) => void;
};

const known = (gender: string | null | undefined): string | undefined =>
  gender && gender !== 'unknown' ? gender : undefined;

/** The editor's view of one transcript line: who speaks, to whom, in which variant. */
const entryLine = (
  entry: DialogEntryRow,
  line: DialogEntryRow['lines'][number],
  opts: DialogUnitOptions,
): ReviewLine => {
  const out: ReviewLine = {
    id: line.string_id,
    kind: line.kind,
    src: line.source,
    tr: line.translation ?? '',
  };
  if (line.context) out.ctx = line.context;
  if (line.kind === 'prompt') {
    // The player picks the prompt; the node's speaker is who they answer.
    out.speaker = 'Player';
    out.speaker_gender = 'any';
    if (entry.speaker) out.addressee = entry.speaker;
    const g = known(entry.speaker_gender);
    if (g) out.addressee_gender = g;
  } else {
    out.speaker = entry.speaker ?? line.context ?? undefined;
    out.speaker_gender = entry.speaker_gender;
    if (entry.addressee_kind === 'player') {
      out.addressee = 'Player';
      out.addressee_gender = 'any';
    } else if (entry.addressee) {
      out.addressee = entry.addressee;
      const g = known(entry.addressee_gender);
      if (g) out.addressee_gender = g;
    }
  }
  if (entry.variant_count > 1) out.variant = `${entry.variant_index}/${entry.variant_count}`;
  if (entry.depth > 0) out.branch_depth = entry.depth;
  if (line.voice_variant != null) out.voice_variant = line.voice_variant;
  if (line.provenance && opts.contextProvenances?.has(line.provenance)) out.context_only = true;
  return out;
};

/** Reviewable lines of a transcript not yet placed in an earlier unit. */
export const transcriptLines = (
  transcript: DialogTranscriptRow,
  seen: Set<number>,
  opts: DialogUnitOptions,
): ReviewLine[] => {
  const lines: ReviewLine[] = [];
  for (const entry of transcript.entries) {
    for (const line of entry.lines) {
      if (seen.has(line.string_id) || line.translation == null) continue;
      if (line.status && UNREVIEWABLE_STATUSES.has(line.status)) continue;
      seen.add(line.string_id);
      lines.push(entryLine(entry, line, opts));
    }
  }
  return lines;
};

/** Every reviewable dialogue line of a mod, as conversation-sized units. Fills `seen`. */
export const collectDialogUnits = async (
  db: Tx,
  modId: number,
  seen: Set<number>,
  opts: DialogUnitOptions,
): Promise<ReviewUnit[]> => {
  const units: ReviewUnit[] = [];
  for (const { scope, kind } of SCOPES) {
    const groups = (await listDialogGroups(db, modId, scope, opts.srcLang, opts.targetLang))
      .filter((g) => g.translated_count > 0)
      .sort((a, b) => a.label.localeCompare(b.label, 'en'));
    for (const [i, group] of groups.entries()) {
      opts.onProgress?.(scope, i, groups.length);
      const transcript = await getDialogTranscript(
        db,
        modId,
        scope,
        group.key,
        opts.srcLang,
        opts.targetLang,
      );
      if (!transcript) continue;
      const lines = transcriptLines(transcript, seen, opts);
      if (lines.length === 0) continue;
      units.push({
        unit_id: `${scope}:${group.key}`,
        kind,
        label: transcript.label,
        ...(transcript.timing_sensitive ? { timing_sensitive: true } : {}),
        lines,
      });
    }
  }
  return units;
};
