/**
 * SettingsPage — Project Settings hub.
 *
 * Organises all configurable aspects of the tool into a tabbed layout:
 *
 *   Tab 1 — General:    default source / target languages, UI language, theme.
 *   Tab 2 — LLM:        read-only display of the active LLM runtime config.
 *   Tab 3 — QA Rules:   forbidden characters, length limits, and custom checks.
 *   Tab 4 — TradAuto:   pattern-match rules for automatic translation.
 *   Tab 5 — TMX:        export / import translation memory in TMX format.
 *   Tab 6 — Activity:   paginated audit log of user actions.
 *   Tab 7 — Data:       link-cards to Glossary and other data pages.
 *   Tab 8 — Users:      user management (only visible in multi-user mode).
 *
 * "General" preferences are stored in localStorage.
 * "LLM" settings come from ENV, displayed read-only.
 * Tabs 3–6 embed their respective standalone pages directly.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../components/ThemeContext';
import { useAuth } from '../../components/AuthContext';
import { UI_LANGUAGES } from '../../i18n';
import { api } from '../../api';
import { QARulesPage } from '../QARulesPage';
import { TradAutoPage } from '../TradAutoPage';
import { TmxPage } from '../TmxPage';
import { ActivityPage } from '../ActivityPage';
import s from './SettingsPage.module.scss';
import { LS_SRC_LANG, LS_TGT_LANG, DEFAULT_SRC_LANG, DEFAULT_TGT_LANG } from '../../langDefaults';

/* ── Supported content languages ────────────────────────────────────────── */

/**
 * Languages supported for source / target in mods and translation flows.
 * Separate from UI_LANGUAGES — these are Bethesda-game string locales.
 */
const CONTENT_LANGUAGES = [
  { code: 'en', label: 'English (en)' },
  { code: 'uk', label: 'Ukrainian (uk)' },
  { code: 'ru', label: 'Russian (ru)' },
  { code: 'de', label: 'German (de)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'it', label: 'Italian (it)' },
  { code: 'pl', label: 'Polish (pl)' },
  { code: 'pt', label: 'Portuguese (pt)' },
  { code: 'cs', label: 'Czech (cs)' },
];

/** Reads a stored locale from localStorage, returning the fallback if absent. */
const getLsLang = (key: string, fallback: string): string =>
  localStorage.getItem(key) ?? fallback;

/* ── Tab identifiers ─────────────────────────────────────────────────────── */

type TabId = 'general' | 'llm' | 'qaRules' | 'tradAuto' | 'tmx' | 'activity' | 'data' | 'users';

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * SettingsPage root component.
 *
 * Renders the tab bar and delegates to per-tab section components.
 * The active tab index is kept in local state — no URL param needed.
 */
export const SettingsPage = () => {
  const { t } = useTranslation();
  const { multiUser } = useAuth();

  const [tab, setTab] = useState<TabId>('general');

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general',  label: t('settings.tabs.general') },
    { id: 'llm',      label: t('settings.tabs.llm') },
    { id: 'qaRules',  label: t('settings.tabs.qaRules') },
    { id: 'tradAuto', label: t('settings.tabs.tradAuto') },
    { id: 'tmx',      label: t('settings.tabs.tmx') },
    { id: 'activity', label: t('settings.tabs.activity') },
    { id: 'data',     label: t('settings.tabs.data') },
    ...(multiUser ? [{ id: 'users' as TabId, label: t('settings.tabs.users') }] : []),
  ];

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('settings.title')}</h1>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className={s.tabs}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            className={`${s.tab} ${tab === id ? s.tabActive : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab panels ───────────────────────────────────────────────── */}
      {tab === 'general'  && <GeneralTab />}
      {tab === 'llm'      && <LlmTab />}
      {tab === 'qaRules'  && <QARulesPage />}
      {tab === 'tradAuto' && <TradAutoPage />}
      {tab === 'tmx'      && <TmxPage />}
      {tab === 'activity' && <ActivityPage />}
      {tab === 'data'     && <DataTab />}
      {tab === 'users'    && <UsersTab />}
    </div>
  );
};

/* ══════════════════ Tab 1: General ══════════════════════════════════════════ */

/**
 * General settings tab.
 *
 * Controls stored in localStorage:
 *  - Default source language (fo4-src-lang)
 *  - Default target language (fo4-tgt-lang)
 *  - Theme (dark / light) via ThemeContext
 *  - UI language via i18next
 */
const GeneralTab = () => {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  // Default content language state — synced with localStorage on change
  const [srcLang, setSrcLang] = useState(() => getLsLang(LS_SRC_LANG, DEFAULT_SRC_LANG));
  const [tgtLang, setTgtLang] = useState(() => getLsLang(LS_TGT_LANG, DEFAULT_TGT_LANG));

  /** Persist source language selection to localStorage. */
  const handleSrcLang = (v: string) => {
    setSrcLang(v);
    localStorage.setItem(LS_SRC_LANG, v);
  };

  /** Persist target language selection to localStorage. */
  const handleTgtLang = (v: string) => {
    setTgtLang(v);
    localStorage.setItem(LS_TGT_LANG, v);
  };

  return (
    <>
      {/* ── Default content languages ────────────────────────────────── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.general.languagesTitle')}</h2>
        <p className={s.fieldNote}>{t('settings.general.languagesDesc')}</p>
        <br />
        <div className={s.fieldGrid}>
          <label className={s.fieldLabel}>{t('settings.general.srcLang')}</label>
          <select
            className={s.select}
            value={srcLang}
            onChange={e => handleSrcLang(e.target.value)}
          >
            {CONTENT_LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          <label className={s.fieldLabel}>{t('settings.general.tgtLang')}</label>
          <select
            className={s.select}
            value={tgtLang}
            onChange={e => handleTgtLang(e.target.value)}
          >
            {CONTENT_LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Interface ────────────────────────────────────────────────── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.general.interfaceTitle')}</h2>
        <div className={s.fieldGrid}>
          {/* UI language */}
          <label className={s.fieldLabel}>{t('settings.general.uiLang')}</label>
          <select
            className={s.select}
            value={i18n.language}
            onChange={e => i18n.changeLanguage(e.target.value)}
          >
            {UI_LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          {/* Theme */}
          <label className={s.fieldLabel}>{t('settings.general.theme')}</label>
          <div>
            <button
              className={s.select}
              style={{ cursor: 'pointer' }}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? t('settings.general.themeLight') : t('settings.general.themeDark')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

/* ══════════════════ Tab 2: LLM ══════════════════════════════════════════════ */

/**
 * LLM / Auto-translate tab.
 *
 * Fetches active LLM configuration from `GET /api/settings` and displays it
 * in a read-only grid.  The data comes from server ENV — it cannot be changed
 * at runtime.
 */
const LlmTab = () => {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 60_000,
  });

  if (isLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error || !data) return (
    <div className={`${s.center} ${s.error}`}>
      {t('common.error', { message: String(error) })}
    </div>
  );

  return (
    <>
      {/* Read-only note */}
      <div className={s.readonlyNote}>
        ℹ️ {t('settings.llm.readonlyNote')}
      </div>

      {/* ── Provider ─────────────────────────────────────────────────── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.providerSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.provider')}</span>
          <span className={s.fieldValue}>
            {data.llmProvider}
            {' '}
            <span className={`${s.badge} ${s.badgeOk}`}>{t('common.active')}</span>
          </span>

          <span className={s.fieldLabel}>{t('settings.llm.fallback')}</span>
          <span className={s.fieldValue}>{data.llmFallback}</span>

          <span className={s.fieldLabel}>{t('settings.llm.batchSize')}</span>
          <span className={s.fieldValue}>{data.batchSize}</span>
        </div>
      </div>

      {/* ── Ollama ───────────────────────────────────────────────────── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.ollamaSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.ollamaUrl')}</span>
          <span className={s.fieldValue}>{data.ollamaBaseUrl}</span>

          <span className={s.fieldLabel}>{t('settings.llm.ollamaModel')}</span>
          <span className={s.fieldValue}>{data.ollamaModel || '—'}</span>
        </div>
      </div>

      {/* ── OpenAI ───────────────────────────────────────────────────── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.openaiSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.openaiKey')}</span>
          <span className={s.fieldValue}>
            <span className={`${s.badge} ${data.openaiKeyConfigured ? s.badgeOk : s.badgeWarn}`}>
              {data.openaiKeyConfigured ? t('settings.llm.keySet') : t('settings.llm.keyNotSet')}
            </span>
          </span>

          <span className={s.fieldLabel}>{t('settings.llm.translateModel')}</span>
          <span className={s.fieldValue}>{data.translateModel || '—'}</span>

          <span className={s.fieldLabel}>{t('settings.llm.embedModel')}</span>
          <span className={s.fieldValue}>{data.embedModel || '—'}</span>
        </div>
      </div>

      {/* ── Session ──────────────────────────────────────────────────── */}
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.systemSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.multiUser')}</span>
          <span className={s.fieldValue}>
            <span className={`${s.badge} ${data.multiUser ? s.badgeOk : s.badgeWarn}`}>
              {data.multiUser ? t('common.enabled') : t('common.disabled')}
            </span>
          </span>

          <span className={s.fieldLabel}>{t('settings.llm.sessionLifetime')}</span>
          <span className={s.fieldValue}>{data.sessionLifetimeHours}h</span>
        </div>
      </div>
    </>
  );
};

/* ══════════════════ Tab 3: Data ══════════════════════════════════════════════ */

/**
 * Data management tab — link-cards to QA Rules, TradAuto, and Glossary pages.
 * Provides a central jump-off point for data configuration tasks.
 */
const DataTab = () => {
  const { t } = useTranslation();

  /**
   * Fetch rule counts for badge display.
   * Errors are silently swallowed — the badge simply won't appear.
   */
  const { data: qaRules }   = useQuery({ queryKey: ['qaRules'],   queryFn: () => api.qaRules.list(),   staleTime: 30_000 });
  const { data: tradRules } = useQuery({ queryKey: ['tradAuto'],  queryFn: () => api.tradAuto.list(),  staleTime: 30_000 });
  const { data: glossary }  = useQuery({ queryKey: ['glossary'],  queryFn: () => api.glossary.list(),  staleTime: 30_000 });

  return (
    <div className={s.section}>
      <h2 className={s.sectionTitle}>{t('settings.data.title')}</h2>
      <p className={s.fieldNote}>{t('settings.data.desc')}</p>
      <br />
      <div className={s.linkCards}>
        {/* QA Rules */}
        <Link to="/qa-rules" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.data.qaRules')}</span>
          <span className={s.linkCardDesc}>{t('settings.data.qaRulesDesc')}</span>
          {qaRules != null && (
            <span className={s.linkCardBadge}>
              {t('settings.data.ruleCount', { count: qaRules.length })}
            </span>
          )}
        </Link>

        {/* TradAuto */}
        <Link to="/tradauto" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.data.tradAuto')}</span>
          <span className={s.linkCardDesc}>{t('settings.data.tradAutoDesc')}</span>
          {tradRules != null && (
            <span className={s.linkCardBadge}>
              {t('settings.data.ruleCount', { count: tradRules.length })}
            </span>
          )}
        </Link>

        {/* Glossary */}
        <Link to="/glossary" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.data.glossary')}</span>
          <span className={s.linkCardDesc}>{t('settings.data.glossaryDesc')}</span>
          {glossary != null && (
            <span className={s.linkCardBadge}>
              {t('settings.data.termCount', { count: glossary.length })}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
};

/* ══════════════════ Tab 4: Users (multi-user only) ═══════════════════════════ */

/**
 * Users tab — only rendered when MULTI_USER=true.
 * Provides a link-card to the full /users management page.
 */
const UsersTab = () => {
  const { t } = useTranslation();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.users.list, staleTime: 30_000 });

  return (
    <div className={s.section}>
      <h2 className={s.sectionTitle}>{t('settings.users.title')}</h2>
      <div className={s.linkCards}>
        <Link to="/users" className={s.linkCard}>
          <span className={s.linkCardTitle}>{t('settings.users.manage')}</span>
          <span className={s.linkCardDesc}>{t('settings.users.manageDesc')}</span>
          {users != null && (
            <span className={s.linkCardBadge}>
              {t('settings.users.userCount', { count: users.length })}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
};

