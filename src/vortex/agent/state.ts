/** The agent's memory between ticks and restarts: a state file and a journal. */
import fs from 'node:fs';
import path from 'node:path';

export type AgentSignatures = {
  /** Top-level staging folders (name + mtime) and the order files' stats. */
  watch: string | null;
  /** Unit ids + content hashes of the last synced inventory. */
  units: string | null;
  /** The export order last sent to the server. */
  order: string | null;
};

export type AgentState = {
  signatures: AgentSignatures;
  groupId: number | null;
  lastRunId: number | null;
  lastSyncAt: string | null;
  lastFullScanAt: string | null;
  deliveredArchiveId: number | null;
  deliveredFileName: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  /** Consecutive failures of the same change; drives the retry backoff. */
  failures: number;
  retryAfter: string | null;
  /**
   * The last cycle failed after its plan was made: the server may hold the
   * units but never finished import, carry or TM for them. The next cycle
   * runs the stages even when nothing is left to upload.
   */
  resyncNeeded: boolean;
  /**
   * Paused from the agent's page (or with `--pause`). Kept here so that a
   * restart, a crash or a reboot does not start a sync nobody asked for.
   */
  paused: boolean;
};

export const emptyAgentState = (): AgentState => ({
  signatures: { watch: null, units: null, order: null },
  groupId: null,
  lastRunId: null,
  lastSyncAt: null,
  lastFullScanAt: null,
  deliveredArchiveId: null,
  deliveredFileName: null,
  deliveredAt: null,
  lastError: null,
  failures: 0,
  retryAfter: null,
  resyncNeeded: false,
  paused: false,
});

export const readAgentState = (file: string): AgentState => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AgentState>;
    return {
      ...emptyAgentState(),
      ...raw,
      signatures: { ...emptyAgentState().signatures, ...raw.signatures },
    };
  } catch {
    return emptyAgentState();
  }
};

/** Atomic: a crash mid-write leaves the previous state, never half a file. */
export const writeAgentState = (file: string, state: AgentState): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
};

const JOURNAL_MAX_BYTES = 1024 * 1024;

/** One JSON line per event; the file rotates once to `.1` when it passes 1 MiB. */
export const appendJournal = (file: string, entry: Record<string, unknown>): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > JOURNAL_MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // no journal yet
  }
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

/** The newest journal entries, oldest first; lines that are not JSON are dropped. */
export const readJournalTail = (file: string, max = 40): Array<Record<string, unknown>> => {
  let text: string;
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, size - length);
    } finally {
      fs.closeSync(fd);
    }
    text = buffer.toString('utf8');
  } catch {
    return [];
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    try {
      const entry: unknown = JSON.parse(line);
      if (entry && typeof entry === 'object') entries.push(entry as Record<string, unknown>);
    } catch {
      // a blank line, or the first one cut by the read window
    }
  }
  return entries.slice(-max);
};

/** Exponential backoff: 1, 2, 4 … capped at 30 minutes. */
export const retryDelayMs = (failures: number): number =>
  Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, failures - 1));
