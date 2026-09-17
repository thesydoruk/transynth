/**
 * Map Disco Audio/ wav stems to PO Articy ids (`Dialogue Text` / `AlternateN`).
 *
 * Wav names are AssetName (`Kim Kitsuragi-YARD  HANGED MAN-324`); lockit msgctxt
 * is `Dialogue Text/0x…`. When actor+conversation have the same number of
 * Dialogue Text rows and main takes, pair PO order with entry-id order.
 *
 * Groups whose counts disagree — one unvoiced line is enough — are left for
 * {@link ../voice/alignTakesByAsr}, which listens to the takes instead of
 * counting them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { discoAudioDir, discoverDiscoLangFolders, listWavFilesRecursive } from '../packLayout';
import { discoDialogueMsgctxtKey } from '../import/poPath';
import type { DiscoPoSpokenLine } from './poVoiceMeta';
import { getDiscoSpokenPoLines } from './spokenPoLines';
import {
  crushDiscoVoiceToken,
  discoWavStemAsciiScore,
  parseDiscoWavStem,
  type DiscoWavStemParts,
} from './voiceStem';

export type DiscoVoiceTextRef = {
  field: string;
  articyId: string;
  msgctxtKey: string;
};

/** One wav take on disk, parsed. */
export type DiscoVoiceTake = DiscoWavStemParts & { absPath: string };

/** Takes and lockit rows of one actor in one conversation. */
export type DiscoVoiceGroup = {
  actor: string;
  conversation: string;
  /** Main takes, entry-id order. */
  takes: DiscoVoiceTake[];
  /** Alternate takes keyed by the main stem they belong to. */
  alternates: Map<string, DiscoVoiceTake[]>;
  /** `Dialogue Text` rows, lockit file order. */
  lines: DiscoPoSpokenLine[];
};

const groupByActorConv = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
};

const actorConvKey = (actorKey: string, conversationKey: string): string =>
  `${actorKey}\0${conversationKey}`;

const applyLibraryFile = (filePath: string, out: Map<string, DiscoVoiceTextRef>): boolean => {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const clips = Array.isArray(raw)
      ? raw
      : raw &&
          typeof raw === 'object' &&
          Array.isArray((raw as { clipInformation?: unknown }).clipInformation)
        ? (raw as { clipInformation: unknown[] }).clipInformation
        : null;
    if (!clips) return false;
    let added = 0;
    for (const clip of clips) {
      if (!clip || typeof clip !== 'object') continue;
      const row = clip as {
        AssetName?: string;
        ArticyID?: string;
        alternativeVoiceClips?: {
          AlternativeID?: number;
          AlternativeAssetName?: string;
        }[];
      };
      const articyId = String(row.ArticyID ?? '').trim();
      const assetName = String(row.AssetName ?? '').trim();
      if (!articyId || !assetName) continue;
      out.set(assetName, {
        field: 'Dialogue Text',
        articyId: articyId.toLowerCase(),
        msgctxtKey: discoDialogueMsgctxtKey('Dialogue Text', articyId),
      });
      added += 1;
      for (const alt of row.alternativeVoiceClips ?? []) {
        const altName = String(alt.AlternativeAssetName ?? '').trim();
        const altId = Number(alt.AlternativeID);
        if (!altName || !Number.isFinite(altId)) continue;
        const field = `Alternate${altId + 1}`;
        out.set(altName, {
          field,
          articyId: articyId.toLowerCase(),
          msgctxtKey: discoDialogueMsgctxtKey(field, articyId),
        });
      }
    }
    return added > 0;
  } catch {
    return false;
  }
};

const loadOptionalClipLibrary = (
  extractRoot: string,
  langFolder: string,
): Map<string, DiscoVoiceTextRef> => {
  const out = new Map<string, DiscoVoiceTextRef>();
  const candidates = [
    path.join(extractRoot, 'VoiceOverClipsLibrary.json'),
    path.join(langFolder, 'VoiceOverClipsLibrary.json'),
    path.join(extractRoot, 'clipInformation.json'),
  ];
  for (const file of candidates) {
    if (applyLibraryFile(file, out)) return out;
  }
  return out;
};

const wavEntryDedupeKey = (wav: DiscoVoiceTake): string =>
  `${crushDiscoVoiceToken(wav.actor)}\0${crushDiscoVoiceToken(wav.conversation)}\0${wav.entryId}\0${wav.alternativeIndex ?? ''}`;

/** One clip per actor+conversation+entry (ASCII filename wins over Mañana/latin-1 twins). */
const dedupeWavsByEntry = (wavs: DiscoVoiceTake[]): DiscoVoiceTake[] => {
  const best = new Map<string, DiscoVoiceTake>();
  for (const wav of wavs) {
    const key = wavEntryDedupeKey(wav);
    const prev = best.get(key);
    if (!prev || discoWavStemAsciiScore(wav.stem) > discoWavStemAsciiScore(prev.stem)) {
      best.set(key, wav);
    }
  }
  return [...best.values()];
};

/** Ref for one take paired with one lockit row. */
export const discoVoiceTextRefFor = (line: DiscoPoSpokenLine): DiscoVoiceTextRef => ({
  field: line.field,
  articyId: line.articyId,
  msgctxtKey: discoDialogueMsgctxtKey(line.field, line.articyId),
});

/** Refs for the alternate takes hanging off one main take. */
export const applyDiscoAlternateRefs = (
  group: DiscoVoiceGroup,
  take: DiscoVoiceTake,
  line: DiscoPoSpokenLine,
  out: Map<string, DiscoVoiceTextRef>,
): void => {
  for (const alt of group.alternates.get(take.mainStem) ?? []) {
    const field = `Alternate${(alt.alternativeIndex ?? 0) + 1}`;
    out.set(alt.stem, {
      field,
      articyId: line.articyId,
      msgctxtKey: discoDialogueMsgctxtKey(field, line.articyId),
    });
  }
};

/** Preferred (English) language folder of a pack, or null when it has none. */
const preferredLangFolder = (extractRoot: string): string | null => {
  const folders = discoverDiscoLangFolders(extractRoot);
  if (folders.length === 0) return null;
  const preferred =
    folders.find((f) => f.locale === 'en') ??
    folders.find((f) => /english/i.test(f.folderName)) ??
    folders[0]!;
  return preferred.absPath;
};

/**
 * Takes and lockit rows of a pack, grouped by actor + conversation.
 *
 * Both sides are ordered the way the pack exported them: takes by entry id,
 * rows by lockit file position. Within a conversation those two orders agree —
 * Articy ids rise with entry ids — which is what makes pairing possible at all.
 */
export const buildDiscoVoiceGroups = (extractRoot: string): DiscoVoiceGroup[] => {
  const langFolder = preferredLangFolder(extractRoot);
  if (!langFolder) return [];

  const spoken = getDiscoSpokenPoLines(langFolder);
  const conversations = new Set(spoken.map((s) => s.conversation).filter(Boolean));

  const wavs: DiscoVoiceTake[] = [];
  for (const abs of listWavFilesRecursive(discoAudioDir(langFolder))) {
    const stem = path.basename(abs, path.extname(abs));
    if (stem.includes('\uFFFD')) continue;
    const parsed = parseDiscoWavStem(stem, conversations);
    if (parsed) wavs.push({ ...parsed, absPath: abs });
  }

  const spokenBy = groupByActorConv(spoken, (s) => actorConvKey(s.actorKey, s.conversationKey));
  const wavBy = groupByActorConv(dedupeWavsByEntry(wavs), (w) =>
    actorConvKey(crushDiscoVoiceToken(w.actor), crushDiscoVoiceToken(w.conversation)),
  );

  const groups: DiscoVoiceGroup[] = [];
  for (const [key, groupWavs] of wavBy) {
    const groupSpoken = spokenBy.get(key);
    if (!groupSpoken) continue;
    const takes = groupWavs
      .filter((w) => w.alternativeIndex == null)
      .sort((a, b) => a.entryId - b.entryId);
    const alternates = new Map<string, DiscoVoiceTake[]>();
    for (const wav of groupWavs) {
      if (wav.alternativeIndex == null) continue;
      const list = alternates.get(wav.mainStem) ?? [];
      list.push(wav);
      alternates.set(wav.mainStem, list);
    }
    groups.push({
      actor: takes[0]?.actor ?? groupWavs[0]?.actor ?? '',
      conversation: takes[0]?.conversation ?? groupWavs[0]?.conversation ?? '',
      takes,
      alternates,
      lines: groupSpoken.filter((s) => s.field === 'Dialogue Text'),
    });
  }
  return groups;
};

/** True when take count and lockit row count agree, so order alone can pair them. */
export const discoGroupZipsByCount = (group: DiscoVoiceGroup): boolean =>
  group.takes.length > 0 && group.takes.length === group.lines.length;

const zipEqualCount = (group: DiscoVoiceGroup, out: Map<string, DiscoVoiceTextRef>): void => {
  if (!discoGroupZipsByCount(group)) return;
  for (let i = 0; i < group.takes.length; i++) {
    const take = group.takes[i]!;
    const line = group.lines[i]!;
    out.set(take.stem, discoVoiceTextRefFor(line));
    applyDiscoAlternateRefs(group, take, line, out);
  }
};

const INDEX_TTL_MS = 5 * 60_000;
const indexCache = new Map<string, { builtAt: number; index: Map<string, DiscoVoiceTextRef> }>();

/** Wav stem → spoken PO field + Articy id. Cached a few minutes per extract root. */
export const getDiscoVoiceTextIndex = (extractRoot: string): Map<string, DiscoVoiceTextRef> => {
  const key = path.resolve(extractRoot);
  const hit = indexCache.get(key);
  if (hit && Date.now() - hit.builtAt < INDEX_TTL_MS) return hit.index;
  const index = buildDiscoVoiceTextIndex(extractRoot);
  indexCache.set(key, { builtAt: Date.now(), index });
  return index;
};

/** Drop cached zip indexes (tests / after pack changes). */
export const invalidateDiscoVoiceTextIndex = (extractRoot?: string): void => {
  if (!extractRoot) {
    indexCache.clear();
    return;
  }
  indexCache.delete(path.resolve(extractRoot));
};

/** Wav stem → spoken PO field + Articy id. */
export const buildDiscoVoiceTextIndex = (extractRoot: string): Map<string, DiscoVoiceTextRef> => {
  const langFolder = preferredLangFolder(extractRoot);
  if (!langFolder) return new Map();

  const fromLibrary = loadOptionalClipLibrary(extractRoot, langFolder);
  if (fromLibrary.size > 0) return fromLibrary;

  const out = new Map<string, DiscoVoiceTextRef>();
  for (const group of buildDiscoVoiceGroups(extractRoot)) zipEqualCount(group, out);
  return out;
};
