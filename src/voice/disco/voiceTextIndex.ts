/**
 * Map Disco Audio/ wav stems to PO Articy ids (`Dialogue Text` / `AlternateN`).
 *
 * Wav names are AssetName (`Kim Kitsuragi-YARD  HANGED MAN-324`); lockit msgctxt
 * is `Dialogue Text/0x…`. When actor+conversation have the same number of
 * Dialogue Text rows and main takes, pair PO order with entry-id order.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  discoAudioDir,
  discoverDiscoLangFolders,
  listPoFilesInDir,
  listWavFilesRecursive,
} from '../../formats/po';
import { discoDialogueMsgctxtKey } from '../../import/mod/discoPoPath';
import { scanDiscoPoSpokenLines, type DiscoPoSpokenLine } from './poVoiceMeta';
import { crushDiscoVoiceToken, parseDiscoWavStem, type DiscoWavStemParts } from './voiceStem';

export type DiscoVoiceTextRef = {
  field: string;
  articyId: string;
  msgctxtKey: string;
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

const zipEqualCount = (
  spoken: DiscoPoSpokenLine[],
  wavs: DiscoWavStemParts[],
  out: Map<string, DiscoVoiceTextRef>,
): void => {
  const mains = wavs
    .filter((w) => w.alternativeIndex == null)
    .sort((a, b) => a.entryId - b.entryId);
  const texts = spoken.filter((s) => s.field === 'Dialogue Text');
  if (mains.length === 0 || mains.length !== texts.length) return;

  const byMain = new Map<string, DiscoWavStemParts[]>();
  for (const wav of wavs) {
    if (wav.alternativeIndex == null) continue;
    const list = byMain.get(wav.mainStem) ?? [];
    list.push(wav);
    byMain.set(wav.mainStem, list);
  }

  for (let i = 0; i < mains.length; i++) {
    const wav = mains[i]!;
    const text = texts[i]!;
    out.set(wav.stem, {
      field: text.field,
      articyId: text.articyId,
      msgctxtKey: discoDialogueMsgctxtKey(text.field, text.articyId),
    });
    for (const alt of byMain.get(wav.mainStem) ?? []) {
      const field = `Alternate${(alt.alternativeIndex ?? 0) + 1}`;
      out.set(alt.stem, {
        field,
        articyId: text.articyId,
        msgctxtKey: discoDialogueMsgctxtKey(field, text.articyId),
      });
    }
  }
};

/** Wav stem → spoken PO field + Articy id. */
export const buildDiscoVoiceTextIndex = (extractRoot: string): Map<string, DiscoVoiceTextRef> => {
  const folders = discoverDiscoLangFolders(extractRoot);
  if (folders.length === 0) return new Map();
  const preferred =
    folders.find((f) => f.locale === 'en') ??
    folders.find((f) => /english/i.test(f.folderName)) ??
    folders[0]!;

  const fromLibrary = loadOptionalClipLibrary(extractRoot, preferred.absPath);
  if (fromLibrary.size > 0) return fromLibrary;

  const spoken = listPoFilesInDir(preferred.absPath).flatMap((poPath) =>
    scanDiscoPoSpokenLines(poPath),
  );
  const conversations = new Set(spoken.map((s) => s.conversation).filter(Boolean));
  const audioDir = discoAudioDir(preferred.absPath);
  const wavs: DiscoWavStemParts[] = [];
  for (const abs of listWavFilesRecursive(audioDir)) {
    const stem = path.basename(abs, path.extname(abs));
    const parsed = parseDiscoWavStem(stem, conversations);
    if (parsed) wavs.push(parsed);
  }

  const spokenBy = groupByActorConv(spoken, (s) => actorConvKey(s.actorKey, s.conversationKey));
  const wavBy = groupByActorConv(wavs, (w) =>
    actorConvKey(crushDiscoVoiceToken(w.actor), crushDiscoVoiceToken(w.conversation)),
  );

  const out = new Map<string, DiscoVoiceTextRef>();
  for (const [key, groupWavs] of wavBy) {
    const groupSpoken = spokenBy.get(key);
    if (!groupSpoken) continue;
    zipEqualCount(groupSpoken, groupWavs, out);
  }
  return out;
};
