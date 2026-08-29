#!/usr/bin/env tsx
/**
 * Delete synthesized clips for lines the TTS skip filter rejects
 * (markers, interject stubs, phonetic vocalizations).
 *
 * Usage:
 *   npm run voice:purge-skipped
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, closeDb } from '../src/db';
import { CONFIG } from '../src/config';
import { log } from '../src/logger';
import { loadImportedMod } from '../src/modImport/importedMod';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from '../src/voice/loadVoiceTranslations';
import {
  resolveVoiceLineSkipReason,
  type VoiceTtsSkipReason,
} from '../src/voice/prepareVoiceTtsText';
import { resolveModVoiceContext } from '../src/web/voice/preview/context';

const LOCALIZED_VOICE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav|lip|xwm)$/i;

const emptyReasonCounts = (): Record<VoiceTtsSkipReason, number> => ({
  interject_stub: 0,
  non_speech_marker: 0,
  empty_after_strip: 0,
  phonetic_vocalization: 0,
});

const collectSkipReasons = (
  sources: Map<string, VoiceSourceDetailRow>,
  translations: Map<string, VoiceTranslationRow>,
): Map<string, VoiceTtsSkipReason> => {
  const skipReasons = new Map<string, VoiceTtsSkipReason>();
  for (const key of new Set([...sources.keys(), ...translations.keys()])) {
    const row = translations.get(key);
    const reason = resolveVoiceLineSkipReason(
      sources.get(key)?.source ?? row?.source,
      row?.translation ?? '',
      row?.edid,
    );
    if (reason) skipReasons.set(key, reason);
  }
  return skipReasons;
};

const unlinkLocalizedSkipClips = (
  localizeDir: string | null,
  skipReasons: Map<string, VoiceTtsSkipReason>,
  byReason: Record<VoiceTtsSkipReason, number>,
): number => {
  if (!localizeDir || !fs.existsSync(localizeDir)) return 0;
  let removed = 0;
  const countedKeys = new Set<string>();
  const walk = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const match = entry.name.match(LOCALIZED_VOICE_RE);
      if (!match) continue;
      const key = voiceTranslationMapKey(match[1]!.slice(-6), Number.parseInt(match[2]!, 10));
      const reason = skipReasons.get(key);
      if (!reason || !fs.existsSync(fullPath)) continue;
      fs.unlinkSync(fullPath);
      removed += 1;
      if (!countedKeys.has(key)) {
        countedKeys.add(key);
        byReason[reason] += 1;
      }
    }
  };
  walk(localizeDir);
  return removed;
};

const db = openDb();
try {
  const lang = CONFIG.defaultTgtLang.trim().toLowerCase();
  const { rows: mods } = await db.query<{ id: number }>(
    `SELECT DISTINCT m.id
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id AND mi.status = 'completed'
     ORDER BY m.id`,
  );

  const byReason = emptyReasonCounts();
  let filesRemoved = 0;
  let dbRowsRemoved = 0;
  let modsScanned = 0;

  for (const mod of mods) {
    const resolved = await resolveModVoiceContext(db, mod.id, lang);
    if (!resolved.ok) continue;

    let imported;
    try {
      imported = await loadImportedMod(db, mod.id);
    } catch {
      continue;
    }
    modsScanned += 1;

    const translations = await loadVoiceTranslations(db, mod.id, imported.srcLang, lang);
    const sources = await loadVoiceSourcesDetailed(db, mod.id, imported.srcLang);
    const skipReasons = collectSkipReasons(sources, translations);
    if (skipReasons.size === 0) continue;

    filesRemoved += unlinkLocalizedSkipClips(resolved.ctx.localizeDir, skipReasons, byReason);

    for (const key of skipReasons.keys()) {
      const [formidLower6, variantText] = key.split(':');
      const variant = Number.parseInt(variantText ?? '', 10);
      if (!formidLower6 || !Number.isFinite(variant)) continue;
      const { rowCount } = await db.query(
        `DELETE FROM voice_synthesis_state
         WHERE mod_id = $1 AND target_lang = $2
           AND formid_lower6 = $3 AND variant = $4`,
        [mod.id, lang, formidLower6.toUpperCase(), variant],
      );
      dbRowsRemoved += rowCount ?? 0;
    }
  }

  log.info('Purged skipped TTS clips', {
    modsScanned,
    filesRemoved,
    dbRowsRemoved,
    byReason,
  });
} finally {
  await closeDb();
}
