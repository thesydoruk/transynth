import { useMemo } from 'react';
import type { DialogEntry, DialogLine, DialogTranscript } from '../../../../../api';
import type { TranscriptFilter } from './useDialogsState';

/** A line still waiting for a translator. */
export const isUntranslated = (line: DialogLine): boolean => !line.translation?.trim();

const matchesFilter = (line: DialogLine, filter: TranscriptFilter): boolean => {
  if (filter === 'todo') return isUntranslated(line);
  if (filter === 'qa') return line.qa_issue_count > 0;
  return true;
};

const matchesText = (line: DialogLine, needle: string): boolean =>
  needle === '' ||
  line.source.toLowerCase().includes(needle) ||
  (line.translation?.toLowerCase().includes(needle) ?? false);

/**
 * Filtered entries plus the flat line order the keyboard cursor walks.
 *
 * Filtering keeps whole entries rather than individual lines: a dialog turn
 * read without its neighbouring lines is easy to mistranslate, so an entry that
 * holds one matching line is shown complete.
 */
export const useTranscriptView = (
  transcript: DialogTranscript | null,
  filter: TranscriptFilter,
  find: string,
) =>
  useMemo(() => {
    const allEntries = transcript?.entries ?? [];
    const needle = find.trim().toLowerCase();

    const entries: DialogEntry[] = allEntries.filter((entry) =>
      entry.lines.some((line) => matchesFilter(line, filter) && matchesText(line, needle)),
    );

    const lines = entries.flatMap((entry) => entry.lines);
    const lineIds = lines.map((line) => line.string_id);
    const lineById = new Map(lines.map((line) => [line.string_id, line]));
    const entryByLineId = new Map(
      entries.flatMap((entry) => entry.lines.map((line) => [line.string_id, entry] as const)),
    );

    const allLines = allEntries.flatMap((entry) => entry.lines);
    const counts = {
      total: allLines.length,
      translated: allLines.filter((line) => !isUntranslated(line)).length,
      qa: allLines.filter((line) => line.qa_issue_count > 0).length,
    };

    return {
      entries,
      lines,
      lineIds,
      lineById,
      /** Owning turn of a line — the other half of a voice-over lookup. */
      entryByLineId,
      counts,
      hiddenEntryCount: allEntries.length - entries.length,
    };
  }, [transcript, filter, find]);

/** Return type of {@link useTranscriptView}. */
export type TranscriptView = ReturnType<typeof useTranscriptView>;
