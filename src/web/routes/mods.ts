import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listMods, getMod, getModStats, diffMods, carryOverTranslations, listModLangs, bulkUpdateTranslationStatus, listPreviousVersions } from '../queries.js';
import { applyTMToMod } from '../tm.js';
import { log } from '../../logger.js';
import { CONFIG } from '../../config.js';
import { exportArchive, exportLocalizedStringsFiles, exportPatchedEsp, exportProjectZip } from '../exportService.js';
import { Ba2Reader } from '../../bethesda/ba2Reader.js';
import { BsaReader } from '../../bethesda/bsaReader.js';
import { EspReader } from '../../bethesda/espReader.js';
import type { GameType } from '../../types.js';

export const modsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/mods — list all mods with aggregate stats.
  // Optional query params: ?game=fo4&srcLang=en&targetLang=uk
  app.get<{ Querystring: { game?: string; srcLang?: string; targetLang?: string } }>(
    '/api/mods',
    async (req, reply) => {
      const { game, srcLang, targetLang } = req.query;
      log.debug(`GET /api/mods game=${game ?? 'all'}`);
      const mods = await listMods(db, { game, srcLang, targetLang });
      log.trace(`GET /api/mods → ${mods.length} mods`);
      return reply.send(mods);
    },
  );

  // GET /api/mods/:id — single mod with progress stats
  app.get<{ Params: { id: string } }>('/api/mods/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const stats = await getModStats(db, id);
    return reply.send({ ...(mod as object), stats });
  });

  // GET /api/mods/:id/langs — list all languages available in this mod
  app.get<{ Params: { id: string } }>('/api/mods/:id/langs', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });
    const langs = await listModLangs(db, id);
    return reply.send(langs);
  });

  // GET /api/mods/:id/previous-versions — list older versions of this mod (same name, different hash)
  app.get<{ Params: { id: string } }>('/api/mods/:id/previous-versions', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });
    const rows = await listPreviousVersions(db, id);
    return reply.send(rows);
  });

  // POST /api/mods/:id/tm-apply — auto-fill untranslated strings from TM
  app.post<{ Params: { id: string }; Querystring: { targetLang?: string } }>(
    '/api/mods/:id/tm-apply',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      log.info(`POST /api/mods/${id}/tm-apply lang=${targetLang}`);
      const result = await applyTMToMod(db, id, targetLang);
      log.info(`TM apply result: applied=${result.applied}, skipped=${result.skipped}`);
      return reply.send(result);
    },
  );

  // GET /api/mods/:id/diff?compareModId= — compare two mod versions
  app.get<{ Params: { id: string }; Querystring: { compareModId?: string; targetLang?: string } }>(
    '/api/mods/:id/diff',
    async (req, reply) => {
      const newId = Number(req.params.id);
      const oldId = Number(req.query.compareModId);
      if (!Number.isInteger(newId) || newId < 1) return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldId) || oldId < 1) return reply.code(400).send({ error: 'compareModId is required' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const result = await diffMods(db, newId, oldId, targetLang);
      return reply.send(result);
    },
  );

  // POST /api/mods/:id/carry-over?fromModId=&targetLang= — copy translations from old mod version
  app.post<{ Params: { id: string }; Querystring: { fromModId?: string; targetLang?: string } }>(
    '/api/mods/:id/carry-over',
    async (req, reply) => {
      const newModId = Number(req.params.id);
      const oldModId = Number(req.query.fromModId);
      if (!Number.isInteger(newModId) || newModId < 1) return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldModId) || oldModId < 1) return reply.code(400).send({ error: 'fromModId query param is required' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      log.info(`POST /api/mods/${newModId}/carry-over fromModId=${oldModId} targetLang=${targetLang}`);

      try {
        const result = await carryOverTranslations(db, newModId, oldModId, targetLang);
        return reply.send(result);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/strings?srcLang=&targetLang= — generate localized STRINGS files
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/strings',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const game = (mod.game ?? 'fo4') as GameType;
        const files = await exportLocalizedStringsFiles(db, id, mod.abs_path, srcLang, targetLang, game);
        return reply.send({ modId: id, srcLang, targetLang, files });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/esp?srcLang=&targetLang= — patch non-localized ESP with translations
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/esp',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const file = await exportPatchedEsp(db, id, mod.abs_path, srcLang, targetLang);
        return reply.send({ modId: id, srcLang, targetLang, files: [file] });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/ba2?srcLang=&targetLang= — pack localized STRINGS into BA2 archive
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/ba2',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const game = (mod.game ?? 'fo4') as GameType;
        const file = await exportArchive(db, id, mod.abs_path, srcLang, targetLang, game);
        return reply.send({ modId: id, srcLang, targetLang, files: [file] });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/project?srcLang=&targetLang= — full project ZIP (BA2 + ESP)
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/project',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const game = (mod.game ?? 'fo4') as GameType;
        const { zipBuffer, zipFileName } = await exportProjectZip(db, id, mod.abs_path, srcLang, targetLang, game);
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', `attachment; filename="${zipFileName}"`)
          .send(zipBuffer);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // PATCH /api/mods/:id/bulk-review — batch approve/reject selected strings
  app.patch<{
    Params: { id: string };
    Body: { stringIds: number[]; status: 'reviewed' | 'rejected'; targetLang?: string };
  }>('/api/mods/:id/bulk-review', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const { stringIds, status, targetLang = CONFIG.defaultTgtLang } = req.body;
    if (!Array.isArray(stringIds) || stringIds.length === 0) return reply.code(400).send({ error: 'stringIds is required' });
    if (status !== 'reviewed' && status !== 'rejected') return reply.code(400).send({ error: 'status must be reviewed or rejected' });

    const actor = req.user?.role ?? 'translator';
    log.info(`PATCH /api/mods/${id}/bulk-review status=${status} count=${stringIds.length} actor=${actor}`);
    const updated = await bulkUpdateTranslationStatus(db, id, stringIds, status, targetLang, actor);
    return reply.send({ updated });
  });

  // GET /api/mods/:id/ba2 — list all BA2 archives associated with the mod and their file contents
  //
  // Returns an array of archive descriptors, each containing the archive path and its flat
  // file listing.  Only archives whose filename stem starts with the mod name (case-insensitive)
  // are returned — same discovery logic used during import.
  //
  // Response shape: Array<{ archive: string; fileCount: number; files: Ba2FileInfo[] }>
  // Ba2FileInfo: { name: string; ext: string; unpackedSize: number; packed: boolean }
  app.get<{ Params: { id: string } }>(
    '/api/mods/:id/ba2',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path not available' });

      const espPath = mod.abs_path as string;
      const modDir  = path.dirname(espPath);
      const stem    = path.basename(espPath, path.extname(espPath)).toLowerCase();

      const game = ((mod as Record<string, unknown>).game ?? 'fo4') as GameType;

      // Discover all BA2 / BSA files in the same directory whose names start with the mod stem
      let archiveFiles: string[] = [];
      try {
        const allFiles = fs.readdirSync(modDir);
        if (game === 'sse' || game === 'sle' || game === 'fo3' || game === 'fnv') {
          // Skyrim / FO3 / FNV: look for BSA files first, also include BA2 for hybrid mods
          archiveFiles = allFiles
            .filter((f) => {
              const fl = f.toLowerCase();
              return fl.startsWith(stem) && (fl.endsWith('.bsa') || fl.endsWith('.ba2'));
            })
            .sort()
            .map((f) => path.join(modDir, f));
        } else {
          archiveFiles = allFiles
            .filter((f) => f.toLowerCase().endsWith('.ba2') && f.toLowerCase().startsWith(stem))
            .sort()
            .map((f) => path.join(modDir, f));
        }
      } catch (err) {
        log.warn(`Archive browser: could not read mod dir "${modDir}": ${err instanceof Error ? err.message : err}`);
      }

      const archives = archiveFiles.map((archivePath) => {
        const isBsa = archivePath.toLowerCase().endsWith('.bsa');
        try {
          if (isBsa) {
            const reader = new BsaReader(archivePath);
            const entries = reader.list();
            return {
              archive: path.basename(archivePath),
              fileCount: entries.length,
              files: entries.map((e) => ({ name: e.name })),
            };
          }
          const reader = new Ba2Reader(archivePath);
          const entries = reader.listFiles();
          return {
            archive: path.basename(archivePath),
            fileCount: reader.fileCount,
            files: entries.map((name) => ({ name })),
          };
        } catch (err) {
          log.warn(`Archive browser: could not open "${path.basename(archivePath)}": ${err instanceof Error ? err.message : err}`);
          return { archive: path.basename(archivePath), fileCount: 0, files: [], error: true };
        }
      });

      return reply.send(archives);
    },
  );

  // GET /api/mods/:id/esp/grups — list all top-level GRUP types in the mod's ESP file
  //
  // Reads the ESP/ESM/ESL plugin at mod.abs_path and returns the list of top-level
  // record-group types together with the record count inside each group.  Used by
  // the ESP record explorer page to populate the left-side group selector.
  //
  // Response shape: Array<{ signature: string; recordCount: number }>
  app.get<{ Params: { id: string } }>(
    '/api/mods/:id/esp/grups',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path not available' });

      try {
        const game = ((mod as Record<string, unknown>).game ?? 'fo4') as GameType;
        const reader = new EspReader(mod.abs_path as string, game);
        return reply.send(reader.listGrups());
      } catch (err) {
        log.warn(`ESP explorer grups: failed to open "${mod.abs_path}": ${err instanceof Error ? err.message : err}`);
        return reply.code(500).send({ error: 'Failed to parse ESP file' });
      }
    },
  );

  // GET /api/mods/:id/esp/records — paginated record browser for the ESP explorer
  //
  // Query parameters:
  //   sig      — 4-char record type to filter by (e.g. "ARMO"). Omit for all records.
  //   page     — 0-based page number (default 0).
  //   pageSize — Records per page, capped at 200 (default 50).
  //   q        — Optional search term matched against FormID, EDID, and subrecord text hints.
  //
  // Response shape: { records: EspRecordView[]; total: number }
  app.get<{
    Params: { id: string };
    Querystring: { sig?: string; page?: string; pageSize?: string; q?: string };
  }>(
    '/api/mods/:id/esp/records',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path not available' });

      const sig      = (req.query.sig ?? '').toUpperCase().slice(0, 4);
      const page     = Math.max(0, Number(req.query.page ?? 0));
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
      const q        = req.query.q ?? '';

      try {
        const game = ((mod as Record<string, unknown>).game ?? 'fo4') as GameType;
        const reader = new EspReader(mod.abs_path as string, game);
        const result = reader.getRecordsPage(sig, page * pageSize, pageSize, q);
        return reply.send(result);
      } catch (err) {
        log.warn(`ESP explorer records: failed to read "${mod.abs_path}": ${err instanceof Error ? err.message : err}`);
        return reply.code(500).send({ error: 'Failed to read ESP records' });
      }
    },
  );
}
