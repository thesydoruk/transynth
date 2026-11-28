/** What one vocal effort analysis of a mod found (`AnalyzeVocalEffortResult` on the server). */
export type VoiceEffortResult = {
  modId: number;
  /** Original takes the mod ships. */
  takes: number;
  /** Takes decoded and measured in this run; earlier runs measured the rest. */
  measured: number;
  /** Takes that could not be decoded; the next run tries them again. */
  failed: number;
  /** Takes whose line has words to say; grunts and sound labels are never tagged. */
  spokenTakes: number;
  /** Of `spokenTakes`, the takes that were judged: measured, and their speaker has a baseline. */
  judgedTakes: number;
  speakers: number;
  /** Speakers with enough calm lines to be judged. */
  speakersWithBaseline: number;
  /** Takes of the speakers without a baseline — how much the small voices leave out. */
  takesWithoutBaseline: number;
  shouting: number;
  loud: number;
  skipped: boolean;
  reason?: string;
  /** Stopped before every take was measured; no line was tagged in this run. */
  cancelled?: boolean;
};

export type VoiceEffortJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  /** Takes with a measurement, of all the mod's takes. */
  done: number;
  total: number;
  error: string | null;
  result: VoiceEffortResult | null;
};

export type VoiceEffortStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; done: number; total: number; result: VoiceEffortResult }
  | { type: 'cancelled'; done: number; total: number }
  | { type: 'error'; error: string };

/** GET /api/games/:gameId/voice-effort-summary */
export type VoiceEffortGameSummary = {
  /** Mods of the game with at least one analyzed take. */
  analyzedMods: number;
  /** Takes with a tag in force. */
  taggedTakes: number;
  /** Tagged takes that already have a synthesized take; switching tags on makes them stale. */
  synthesizedTaggedTakes: number;
};
