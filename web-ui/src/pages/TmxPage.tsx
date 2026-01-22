/**
 * TMX (Translation Memory eXchange) page.
 *
 * Provides UI for exporting translations as TMX files and importing TMX files
 * to populate the translation memory. Supports per-mod and global operations.
 */

import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api';
import s from './TmxPage.module.scss';

export const TmxPage = () => {
  const { data: mods } = useQuery({ queryKey: ['mods'], queryFn: api.mods.list });

  /* ── Export state ─────────────────────────────────────────────────────────── */
  const [exportModId, setExportModId] = useState('');
  const [exportLang, setExportLang] = useState('uk');

  const exportMutation = useMutation({
    mutationFn: () =>
      api.tmx.exportFile('en', exportLang, exportModId ? Number(exportModId) : undefined),
  });

  /* ── Import state ────────────────────────────────────────────────────────── */
  const [importModId, setImportModId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) =>
      api.tmx.importFile(file, importModId ? Number(importModId) : undefined),
  });

  /** Handle import form submission — reads the file from the input and fires the mutation */
  const handleImport = () => {
    const file = fileRef.current?.files?.[0];
    if (file) importMutation.mutate(file);
  };

  return (
    <div className={s.page}>
      <h1 className={s.title}>Translation Memory Exchange (TMX)</h1>
      <p className={s.subtitle}>
        Export or import translation memory in the standard TMX 1.4b format for use with
        external CAT tools (memoQ, SDL Trados, OmegaT, etc.).
      </p>

      {/* ── Export section ──────────────────────────────────────────────────── */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Export TMX</h2>
        <p className={s.sectionDesc}>
          Download all translations (or for a specific mod) as a TMX file.
        </p>

        <div className={s.row}>
          <div className={s.field}>
            <label className={s.label}>Mod (optional)</label>
            <select
              className={s.select}
              value={exportModId}
              onChange={(e) => setExportModId(e.target.value)}
            >
              <option value="">All mods</option>
              {mods?.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className={s.field}>
            <label className={s.label}>Target language</label>
            <select
              className={s.select}
              value={exportLang}
              onChange={(e) => setExportLang(e.target.value)}
            >
              <option value="uk">Ukrainian (uk)</option>
              <option value="ru">Russian (ru)</option>
              <option value="de">German (de)</option>
              <option value="fr">French (fr)</option>
              <option value="es">Spanish (es)</option>
            </select>
          </div>

          <button
            className={s.btnPrimary}
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? 'Exporting…' : '⬇ Export TMX'}
          </button>
        </div>

        {exportMutation.isSuccess && (
          <div className={s.result}>TMX file downloaded successfully.</div>
        )}
        {exportMutation.isError && (
          <div className={s.error}>Error: {String(exportMutation.error)}</div>
        )}
      </section>

      {/* ── Import section ──────────────────────────────────────────────────── */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Import TMX</h2>
        <p className={s.sectionDesc}>
          Upload a TMX file to populate translations. Only strings without existing
          reviewed/human translations will be updated.
        </p>

        <div className={s.row}>
          <div className={s.field}>
            <label className={s.label}>Match against mod (optional)</label>
            <select
              className={s.select}
              value={importModId}
              onChange={(e) => setImportModId(e.target.value)}
            >
              <option value="">All mods (global)</option>
              {mods?.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className={s.field}>
            <label className={s.label}>TMX file</label>
            <input
              ref={fileRef}
              type="file"
              accept=".tmx,.xml"
              className={s.fileInput}
            />
          </div>

          <button
            className={s.btnGreen}
            onClick={handleImport}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? 'Importing…' : '⬆ Import TMX'}
          </button>
        </div>

        {importMutation.data && (
          <div className={s.result}>
            Parsed: <b>{importMutation.data.parsed}</b>
            {' · '}Imported: <b>{importMutation.data.imported}</b>
            {' · '}Skipped: <b>{importMutation.data.skipped}</b>
          </div>
        )}
        {importMutation.isError && (
          <div className={s.error}>Error: {String(importMutation.error)}</div>
        )}
      </section>
    </div>
  );
};
