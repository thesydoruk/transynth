/**
 * WorkflowTab — Project-level workflow and QA settings.
 *
 * Displays toggles and numeric inputs for all persisted project settings
 * from the `project_settings` DB table.  Each control updates a single key
 * immediately on change via PUT /api/project-settings/:key.
 */

import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import parentS from '../SettingsPage.module.scss';
import { PipelineSection } from './PipelineSection';
import { RagIndexSection } from './RagIndexSection';
import s from './WorkflowTab.module.scss';

/** Shape of all project settings as returned by GET /api/project-settings. */
type ProjectSettings = {
  'workflow.auto_approve_on_save': boolean;
  'workflow.propagate_to_identical': boolean;
  'workflow.hide_ignored_by_default': boolean;
  'qa.end_punct_match': boolean;
  'qa.min_word_count': number;
  'import.skip_tes4': boolean;
  'llm.rag_max_examples': number;
  'llm.rag_min_similarity': number;
  'pipeline.dependency_wait_timeout_sec': number;
  'pipeline.health_check_interval_sec': number;
};

const DEFAULTS: ProjectSettings = {
  'workflow.auto_approve_on_save': false,
  'workflow.propagate_to_identical': true,
  'workflow.hide_ignored_by_default': false,
  'qa.end_punct_match': true,
  'qa.min_word_count': 1,
  'import.skip_tes4': false,
  'llm.rag_max_examples': 5,
  'llm.rag_min_similarity': 0.5,
  'pipeline.dependency_wait_timeout_sec': 600,
  'pipeline.health_check_interval_sec': 10,
};

/** WorkflowTab root component. */
export const WorkflowTab = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['projectSettings'],
    queryFn: () => api.projectSettings.getAll() as Promise<ProjectSettings>,
    staleTime: 30_000,
  });

  const { mutate: update } = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean | number }) =>
      api.projectSettings.update(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projectSettings'] });
    },
  });

  const settings: ProjectSettings = { ...DEFAULTS, ...(data ?? {}) };

  const handleToggle = (key: keyof ProjectSettings) => {
    update({ key, value: !settings[key] });
  };

  const handleNumber = (key: keyof ProjectSettings, raw: string) => {
    if (key === 'llm.rag_min_similarity') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n) && n >= 0 && n <= 1) update({ key, value: n });
      return;
    }
    if (
      key === 'pipeline.dependency_wait_timeout_sec' ||
      key === 'pipeline.health_check_interval_sec'
    ) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= 1) update({ key, value: n });
      return;
    }
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0) update({ key, value: n });
  };

  if (isLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error) {
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(error) })}
      </div>
    );
  }

  return (
    <>
      <PipelineSection settings={settings} onNumber={handleNumber} />

      {/* ── Workflow section ────────────────────────────────────────────── */}
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.workflow.sectionWorkflow')}</h2>

        <div className={s.settingsList}>
          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.autoApprove')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.autoApproveDesc')}</span>
            </div>
            <label className={s.toggle}>
              <input
                type="checkbox"
                checked={settings['workflow.auto_approve_on_save']}
                onChange={() => handleToggle('workflow.auto_approve_on_save')}
              />
              <span className={s.toggleTrack} />
            </label>
          </div>

          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.propagate')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.propagateDesc')}</span>
            </div>
            <label className={s.toggle}>
              <input
                type="checkbox"
                checked={settings['workflow.propagate_to_identical']}
                onChange={() => handleToggle('workflow.propagate_to_identical')}
              />
              <span className={s.toggleTrack} />
            </label>
          </div>

          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.hideIgnored')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.hideIgnoredDesc')}</span>
            </div>
            <label className={s.toggle}>
              <input
                type="checkbox"
                checked={settings['workflow.hide_ignored_by_default']}
                onChange={() => handleToggle('workflow.hide_ignored_by_default')}
              />
              <span className={s.toggleTrack} />
            </label>
          </div>
        </div>
      </div>

      {/* ── QA checks section ───────────────────────────────────────────── */}
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.workflow.sectionQa')}</h2>

        <div className={s.settingsList}>
          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.endPunctMatch')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.endPunctMatchDesc')}</span>
            </div>
            <label className={s.toggle}>
              <input
                type="checkbox"
                checked={settings['qa.end_punct_match']}
                onChange={() => handleToggle('qa.end_punct_match')}
              />
              <span className={s.toggleTrack} />
            </label>
          </div>

          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.minWordCount')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.minWordCountDesc')}</span>
            </div>
            <input
              type="number"
              className={s.numberInput}
              min={0}
              max={20}
              value={settings['qa.min_word_count']}
              onChange={(e) => handleNumber('qa.min_word_count', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── LLM / RAG section ─────────────────────────────────────────── */}
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.workflow.sectionLlm')}</h2>

        <div className={s.settingsList}>
          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.ragMaxExamples')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.ragMaxExamplesDesc')}</span>
            </div>
            <input
              type="number"
              className={s.numberInput}
              min={1}
              max={10}
              value={settings['llm.rag_max_examples']}
              onChange={(e) => handleNumber('llm.rag_max_examples', e.target.value)}
            />
          </div>

          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.ragMinSimilarity')}</span>
              <span className={parentS.fieldNote}>
                {t('settings.workflow.ragMinSimilarityDesc')}
              </span>
            </div>
            <input
              type="number"
              className={s.numberInput}
              min={0}
              max={1}
              step={0.05}
              value={settings['llm.rag_min_similarity']}
              onChange={(e) => handleNumber('llm.rag_min_similarity', e.target.value)}
            />
          </div>

          <RagIndexSection />
        </div>
      </div>

      {/* ── Import section ──────────────────────────────────────────────── */}
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.workflow.sectionImport')}</h2>

        <div className={s.settingsList}>
          <div className={s.settingRow}>
            <div className={s.settingInfo}>
              <span className={s.settingLabel}>{t('settings.workflow.skipTes4')}</span>
              <span className={parentS.fieldNote}>{t('settings.workflow.skipTes4Desc')}</span>
            </div>
            <label className={s.toggle}>
              <input
                type="checkbox"
                checked={settings['import.skip_tes4']}
                onChange={() => handleToggle('import.skip_tes4')}
              />
              <span className={s.toggleTrack} />
            </label>
          </div>
        </div>
      </div>
    </>
  );
};
