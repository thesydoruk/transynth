/**
 * TMX (Translation Memory eXchange) page.
 *
 * Provides UI for exporting translations as TMX files and importing TMX files
 * to populate the translation memory. Supports per-mod and global operations.
 */

import { useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { getSrcLang, getTgtLang } from '../../langDefaults';
import { Button } from '../../components/Button';
import s from './TmxPage.module.scss';

export const TmxPage = ({ embedded = false }: { embedded?: boolean }) => {
  const { t } = useTranslation();
  const { data: mods } = useQuery({ queryKey: ['mods'], queryFn: () => api.mods.list() });

  /* ── Export state ─────────────────────────────────────────────────────────── */
  const [exportModId, setExportModId] = useState('');
  const [exportLang, setExportLang] = useState(getTgtLang());

  /* ── TM stats ─────────────────────────────────────────────────────────────── */
  const { data: stats } = useQuery({
    queryKey: ['tmx-stats', exportLang],
    queryFn: () => api.tmx.stats(getSrcLang(), exportLang),
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      api.tmx.exportFile(getSrcLang(), exportLang, exportModId ? Number(exportModId) : undefined),
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
    <div className={`${s.page} ${embedded ? s.pageEmbedded : ''}`}>
      <h1 className={s.title}>{t('tmx.title')}</h1>
      <p className={s.subtitle}>{t('tmx.subtitle')}</p>

      <section className={s.workflowNote} aria-label={t('tmx.workflowNoteTitle')}>
        <div>
          <h2 className={s.workflowTitle}>{t('tmx.workflowNoteTitle')}</h2>
          <p className={s.workflowText}>{t('tmx.workflowNoteBody')}</p>
          <p className={s.workflowHint}>{t('tmx.workflowMaintenanceHint')}</p>
        </div>
        <Link to="/diff" className={s.workflowLink}>
          {t('tmx.workflowReleaseAction')}
        </Link>
      </section>

      {/* ── TM stats strip ──────────────────────────────────────────────────── */}
      {stats && (
        <div className={s.statsStrip}>
          <div className={s.statItem}>
            <span className={s.statLabel}>{t('tmx.statsTotal')}</span>
            <span className={s.statValue}>{stats.totalStrings.toLocaleString()}</span>
          </div>
          <div className={s.statItem}>
            <span className={s.statLabel}>{t('tmx.statsTranslated')}</span>
            <span className={s.statValue}>{stats.translatedStrings.toLocaleString()}</span>
          </div>
          <div className={s.statItem}>
            <span className={s.statLabel}>{t('tmx.statsCoverage')}</span>
            <span className={s.statCoverage}>{stats.coverage}%</span>
          </div>
        </div>
      )}

      {/* ── Export section ──────────────────────────────────────────────────── */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>{t('tmx.exportTitle')}</h2>
        <p className={s.sectionDesc}>{t('tmx.exportDesc')}</p>

        <div className={s.row}>
          <div className={s.field}>
            <label className={s.label}>{t('tmx.modOptional')}</label>
            <select
              className={s.select}
              value={exportModId}
              onChange={(e) => setExportModId(e.target.value)}
            >
              <option value="">{t('tmx.allMods')}</option>
              {mods?.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className={s.field}>
            <label className={s.label}>{t('tmx.targetLanguage')}</label>
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

          <Button
            variant="primary"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? t('tmx.exportingBtn') : t('tmx.exportBtn')}
          </Button>
        </div>

        {exportMutation.isSuccess && (
          <div className={s.result}>{t('tmx.exportSuccess')}</div>
        )}
        {exportMutation.isError && (
          <div className={s.error}>{t('common.error', { message: String(exportMutation.error) })}</div>
        )}
      </section>

      {/* ── Import section ──────────────────────────────────────────────────── */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>{t('tmx.importTitle')}</h2>
        <p className={s.sectionDesc}>{t('tmx.importDesc')}</p>

        <div className={s.row}>
          <div className={s.field}>
            <label className={s.label}>{t('tmx.matchAgainst')}</label>
            <select
              className={s.select}
              value={importModId}
              onChange={(e) => setImportModId(e.target.value)}
            >
              <option value="">{t('tmx.allModsGlobal')}</option>
              {mods?.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className={s.field}>
            <label className={s.label}>{t('tmx.tmxFile')}</label>
            <input
              ref={fileRef}
              type="file"
              accept=".tmx,.xml"
              className={s.fileInput}
            />
          </div>

          <Button
            variant="success"
            onClick={handleImport}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? t('tmx.importingBtn') : t('tmx.importBtn')}
          </Button>
        </div>

        {importMutation.data && (
          <div className={s.result}>
            {t('tmx.parsed')}: <b>{importMutation.data.parsed}</b>
            {' · '}{t('tmx.imported')}: <b>{importMutation.data.imported}</b>
            {' · '}{t('tmx.importSkipped')}: <b>{importMutation.data.skipped}</b>
          </div>
        )}
        {importMutation.isError && (
          <div className={s.error}>{t('common.error', { message: String(importMutation.error) })}</div>
        )}
      </section>
    </div>
  );
};

